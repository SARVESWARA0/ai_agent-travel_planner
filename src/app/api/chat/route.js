import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { convertToCoreMessages, streamText } from "ai";
import axios from "axios";
import { z } from "zod";

// Existing API key setup...
const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY,
});
const mapboxToken = process.env.mapboxToken;
const foursquareApiKey = process.env.FOURSQUARE_API_KEY;

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
const getHistoricalInfo = async (location) => {
  try {
    // First, search for the location page
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(location)}&format=json&origin=*`;
    const searchResponse = await axios.get(searchUrl);
    const pageId = searchResponse.data.query.search[0]?.pageid;

    if (!pageId) {
      return { success: false, message: "No historical information found." };
    }

    // Get the page content
    const contentUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&pageids=${pageId}&format=json&origin=*`;
    const contentResponse = await axios.get(contentUrl);
    const extract = contentResponse.data.query.pages[pageId].extract;

    // Get the page URL
    const titleUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=info&inprop=url&pageids=${pageId}&format=json&origin=*`;
    const titleResponse = await axios.get(titleUrl);
    const pageUrl = titleResponse.data.query.pages[pageId].fullurl;

    return {
      success: true,
      history: {
        summary: extract,
        source: pageUrl
      }
    };
  } catch (error) {
    console.error("Error fetching historical information:", error);
    return { success: false, message: "Failed to fetch historical information." };
  }
};



// New function to get hotel recommendations from Foursquare
const getHotelRecommendations = async (coordinates) => {
  try {
    const url = `https://api.foursquare.com/v3/places/search?query=hotel&ll=${coordinates.lat},${coordinates.lon}&sort=RATING&limit=5`;
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': foursquareApiKey,
        'Accept': 'application/json'
      }
    });

    const hotels = response.data.results.map(hotel => ({
      name: hotel.name,
      rating: hotel.rating || 'N/A',
      address: hotel.location.formatted_address,
      category: hotel.categories[0]?.name || 'Hotel',
      link: `https://foursquare.com/v/${hotel.fsq_id}`
    }));

    return {
      success: true,
      hotels
    };
  } catch (error) {
    console.error("Error fetching hotel recommendations:", error);
    return { success: false, message: "Failed to fetch hotel recommendations." };
  }
};

// Enhanced getRouteAndDetails function
const getRouteAndDetails = async (origin, destination, travelMode = 'driving') => {
  const originCoords = await getCoordinates(origin);
  const destinationCoords = await getCoordinates(destination);

  if (!originCoords || !destinationCoords) {
    return { success: false, message: "Failed to get coordinates for origin or destination." };
  }

  // Fetch all information in parallel
  const [routeResult, popularPlaces, historicalInfo, hotels] = await Promise.all([
    getRouteDetails(originCoords, destinationCoords, travelMode),
    getPopularPlaces(destination),
    getHistoricalInfo(destination),
    getHotelRecommendations(destinationCoords)
  ]);

  if (!routeResult.success) {
    return { success: false, message: routeResult.message };
  }

  const mapboxDirectionsUrl = `https://www.mapbox.com/directions/?start=${originCoords.lon},${originCoords.lat}&end=${destinationCoords.lon},${destinationCoords.lat}&profile=${travelMode}`;
  const googleMapsDirectionsUrl = `https://www.google.com/maps/dir/?api=1&origin=${originCoords.lat},${originCoords.lon}&destination=${destinationCoords.lat},${destinationCoords.lon}&travelmode=${travelMode}`;

  return {
    success: true,
    duration: routeResult.duration,
    distance: routeResult.distance,
    directions: routeResult.directions,
    placesAlongRoute: routeResult.places,
    popularPlaces: popularPlaces.success ? popularPlaces.places : [],
    historicalInfo: historicalInfo.success ? historicalInfo.history : null,
    hotels: hotels.success ? hotels.hotels : [],
    mapboxUrl: mapboxDirectionsUrl,
    googleMapsUrl: googleMapsDirectionsUrl,
  };
};

// Updated POST handler with enhanced tools
export async function POST(req) {
  try {
    const { messages } = await req.json();
    const model = google("gemini-1.5-pro-002");

    const tools = {
      get_route: {
        description: "Get comprehensive travel information including route details, historical information, and hotel recommendations.",
        parameters: z.object({
          origin: z.string(),
          destination: z.string(),
          travelMode: z.enum(['driving']).optional(),
        }),
        execute: async ({ origin, destination, travelMode = 'driving' }) => {
          console.log("User input for travel planning:", origin, destination, travelMode);

          try {
            const result = await getRouteAndDetails(origin, destination, travelMode);

            if (result.success) {
              const placesAlongRouteDescription = result.placesAlongRoute
                .slice(0, 5)
                .map((p, index) => 
                  `${index + 1}. ${p.name}: ${p.instruction} (${p.distance.toFixed(2)} m, ${Math.floor(p.duration / 60)} min)`
                ).join('\n');

              const popularPlacesDescription = result.popularPlaces
                .map((p, index) => 
                  `${index + 1}. [${p.title}](${p.url}): ${p.description}`
                ).join('\n');

              const hotelRecommendations = result.hotels
                .map((h, index) => 
                  `${index + 1}. [${h.name}](${h.link}) - ${h.category} (Rating: ${h.rating})\n   Address: ${h.address}`
                ).join('\n');

              return {
                text: `Travel Plan: ${origin} to ${destination}

Route Information:
- Duration: ${result.duration}
- Distance: ${result.distance}

Detailed directions: ${result.directions}

Historical Information about ${destination}:
${result.historicalInfo ? result.historicalInfo.summary : 'No historical information available.'}
${result.historicalInfo ? `\nRead more: ${result.historicalInfo.source}` : ''}

Notable places along the route:
${placesAlongRouteDescription}

Popular places to visit at ${destination}:
${popularPlacesDescription}

Recommended Hotels:
${hotelRecommendations}

Interactive Maps:
- [Google Maps Directions](${result.googleMapsUrl})

Note: Click the links to view interactive maps and more details about places and hotels.`,
              };
            } else {
              return { text: result.message };
            }
          } catch (error) {
            console.error("Error in travel planning:", error);
            return { text: "There was an error retrieving travel information." };
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