// distanceService.js
// this service calculates the driving distance from the user's location to each branch
// it uses the Google Maps Distance Matrix API for real driving distances
// if the Google Maps API call fails, it falls back to the Haversine formula (straight-line distance × 1.3)

const { Client } = require('@googlemaps/google-maps-services-js');

// create a Google Maps client
const googleMapsClient = new Client({});

// haversine formula: calculates the straight-line distance between two points on a sphere
// returns distance in kilometers
function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in kilometers
    const toRad = (deg) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

// get driving distance using Google Maps Distance Matrix API
// falls back to haversine × 1.3 if Google Maps fails
// returns an array of { branchId, distanceKm } for each destination
async function getDistances(userLat, userLng, destinations) {
    // destinations is an array of { branchId, latitude, longitude }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    // try Google Maps API first
    if (apiKey) {
        try {
            const origins = [{ lat: userLat, lng: userLng }];
            const dests = destinations.map(d => ({ lat: d.latitude, lng: d.longitude }));

            const response = await googleMapsClient.distancematrix({
                params: {
                    origins: origins,
                    destinations: dests,
                    mode: 'driving',
                    key: apiKey
                }
            });

            const rows = response.data.rows[0];
            if (rows && rows.elements) {
                return destinations.map((dest, index) => {
                    const element = rows.elements[index];
                    let distanceKm = null;

                    if (element.status === 'OK' && element.distance) {
                        // distance.value is in meters, convert to km
                        distanceKm = element.distance.value / 1000;
                    } else {
                        // fallback: haversine × 1.3 to account for road winding
                        const straightLine = haversineDistance(userLat, userLng, dest.latitude, dest.longitude);
                        distanceKm = Math.round(straightLine * 1.3 * 100) / 100;
                    }

                    return {
                        branchId: dest.branchId,
                        distanceKm: Math.round(distanceKm * 100) / 100
                    };
                });
            }
        } catch (error) {
            console.warn('Google Maps API failed, falling back to Haversine:', error.message);
        }
    }

    // fallback: haversine formula × 1.3 (road winding factor)
    return destinations.map(dest => {
        const straightLine = haversineDistance(userLat, userLng, dest.latitude, dest.longitude);
        const distanceKm = Math.round(straightLine * 1.3 * 100) / 100;
        return {
            branchId: dest.branchId,
            distanceKm
        };
    });
}

module.exports = { getDistances };
