import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { convertToCoreMessages, streamText } from "ai";
import axios from "axios";
import { z } from "zod";

// Set up Google AI with API Key from environment variables
const google = createGoogleGenerativeAI({
  apiKey:process.env.GOOGLE_API_KEY, // Replace with your Google API Key
});

// Set up Mapbox access token from environment variables
const mapboxToken = process.env.mapboxToken; // Replace with your Mapbox Token

// Function to get coordinates using Mapbox Geocoding API
const getCoordinates = async (location) => {
  const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(location)}.json?access_token=${mapboxToken}`;

  try {
    const response = await axios.get(geocodeUrl);
    const results = response.data.features;

    if (results.length === 0) {
      return null;
    }

    const [lon, lat] = results[0].geometry.coordinates;
    return { lat, lon };
  } catch (error) {
    console.error("Error fetching coordinates from Mapbox:", error);
    return null;
  }
};

// Function to get route details using Mapbox Directions API
const getRouteDetails = async (origin, destination, travelMode = 'driving') => {
  try {
    const routeUrl = `https://api.mapbox.com/directions/v5/mapbox/${travelMode}/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?geometries=geojson&overview=full&steps=true&access_token=${mapboxToken}`;
    const response = await axios.get(routeUrl);
    const routes = response.data.routes;

    if (!routes || routes.length === 0) {
      return { success: false, message: "No routes found. Please check the origin and destination." };
    }

    const bestRoute = routes[0];
    const { distance, duration, legs } = bestRoute;

    // Extract more detailed directions and places along the route
    const directions = [];
    const places = [];
    legs[0].steps.forEach((step) => {
      directions.push(step.maneuver.instruction);
      if (step.name && step.name !== "") {
        places.push({
          name: step.name,
          instruction: step.maneuver.instruction,
          distance: step.distance,
          duration: step.duration,
        });
      }
    });

    return {
      success: true,
      duration: `${Math.floor(duration / 60)} minutes`,
      distance: `${(distance / 1000).toFixed(2)} km`,
      directions: directions.join(' -> '),
      places: places,
    };
  } catch (error) {
    console.error("Error fetching route details from Mapbox:", error);
    return { success: false, message: "Failed to get route details from Mapbox." };
  }
};

// Function to get popular places to visit using Wikipedia API
const getPopularPlaces = async (location) => {
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(location)} tourist attractions&format=json&origin=*`;
  try {
    const response = await axios.get(searchUrl);
    const searchResults = response.data.query.search;

    if (!searchResults || searchResults.length === 0) {
      return { success: false, message: "No popular places found at the destination." };
    }

    // Fetch summaries for the top search results
    const places = [];
    for (let i = 0; i < Math.min(searchResults.length, 5); i++) {
      const pageTitle = searchResults[i].title;
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;

      const summaryResponse = await axios.get(summaryUrl);
      const summaryData = summaryResponse.data;

      places.push({
        title: summaryData.title,
        description: summaryData.extract,
        url: summaryData.content_urls.desktop.page,
      });
    }

    return {
      success: true,
      places,
    };
  } catch (error) {
    console.error("Error fetching popular places from Wikipedia:", error);
    return { success: false, message: "Failed to get popular places from Wikipedia." };
  }
};

// Function to get the best route and places using Mapbox, Wikipedia, and Google Maps APIs
const getRouteAndDetails = async (origin, destination, travelMode = 'driving') => {
  const originCoords = await getCoordinates(origin);
  const destinationCoords = await getCoordinates(destination);

  if (!originCoords || !destinationCoords) {
    return { success: false, message: "Failed to get coordinates for origin or destination." };
  }

  const routeResult = await getRouteDetails(originCoords, destinationCoords, travelMode);

  if (!routeResult.success) {
    return { success: false, message: routeResult.message };
  }

  const popularPlaces = await getPopularPlaces(destination);

  // Create a direct link to Mapbox with the route
  const mapboxDirectionsUrl = `https://www.mapbox.com/directions/?start=${originCoords.lon},${originCoords.lat}&end=${destinationCoords.lon},${destinationCoords.lat}&profile=${travelMode}`;

  // Create a Google Maps directions link
  const googleMapsDirectionsUrl = `https://www.google.com/maps/dir/?api=1&origin=${originCoords.lat},${originCoords.lon}&destination=${destinationCoords.lat},${destinationCoords.lon}&travelmode=${travelMode}`;

  return {
    success: true,
    duration: routeResult.duration,
    distance: routeResult.distance,
    directions: routeResult.directions,
    placesAlongRoute: routeResult.places,
    popularPlaces: popularPlaces.success ? popularPlaces.places : [],
    mapboxUrl: mapboxDirectionsUrl, // Direct link to Mapbox Directions
    googleMapsUrl: googleMapsDirectionsUrl, // Direct link to Google Maps Directions
  };
};

// Main handler function for POST requests
export async function POST(req) {
  try {
    const { messages } = await req.json();

    const model = google("gemini-1.5-pro-002");

    const tools = {
      get_route: {
        description: "Get the best route between origin and destination using Mapbox API and provide detailed directions, places encountered, and links to both Mapbox and Google Maps interactive directions. Additionally, recommend popular places to visit at the destination using Wikipedia.",
        parameters: z.object({
          origin: z.string(),
          destination: z.string(),
          travelMode: z.enum(['driving', 'walking', 'cycling']).optional(),
        }),
        execute: async ({ origin, destination, travelMode = 'driving' }) => {
          console.log("User input for directions:", origin, destination, travelMode);

          try {
            const result = await getRouteAndDetails(origin, destination, travelMode);

            if (result.success) {
              const placesAlongRouteDescription = result.placesAlongRoute.slice(0, 5).map((p, index) =>
                `${index + 1}. ${p.name}: ${p.instruction} (${p.distance.toFixed(2)} m, ${Math.floor(p.duration / 60)} min)`
              ).join('\n');

              const popularPlacesDescription = result.popularPlaces.map((p, index) =>
                `${index + 1}. [${p.title}](${p.url}): ${p.description}`
              ).join('\n');

              return {
                text: `The best route from ${origin} to ${destination} will take approximately ${result.duration}, covering a distance of ${result.distance}.

Detailed directions: ${result.directions}

Notable places along the route:
${placesAlongRouteDescription}

Popular places to visit at ${destination}:
${popularPlacesDescription}

You can view the interactive route maps here:

- [Google Maps Directions](${result.googleMapsUrl})

Note: These links will open the respective directions interface, allowing you to view the route and directions interactively.`,
              };
            } else {
              return { text: result.message };
            }
          } catch (error) {
            console.error("Error in fetching directions and places:", error);
            return { text: "There was an error retrieving route and place information." };
          }
        },
      },
    };

    const text = await streamText({
      model,
      messages: convertToCoreMessages(messages),
      maxSteps: 4,
      tools,
      generateDirectResponse: false,
    });

    return text.toDataStreamResponse();
  } catch (error) {
    console.error("Error handling POST request:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
