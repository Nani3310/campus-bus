module.exports = {
  port: Number(process.env.PORT || 8080),
  jwtSecret: process.env.JWT_SECRET || "dev-only-change-me",
  deviceApiKey: process.env.DEVICE_API_KEY || "campus-bus-gps-secret",
  campus: {
    name: process.env.CAMPUS_NAME || "IIITDM Kurnool",
    lat: Number(process.env.CAMPUS_LAT || 15.761411),
    lng: Number(process.env.CAMPUS_LNG || 78.039151),
  },
};
