const loadEnv = require("./src/config/loadEnv");

loadEnv();

const app = require("./src/app");
const connectDatabase = require("./src/config/database");

const PORT = Number(process.env.PORT) || 5000;

async function startServer() {
  try {
    await connectDatabase();

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log("CORS is enabled for browser requests via the cors package");
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();
