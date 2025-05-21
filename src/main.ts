#!/usr/bin/env node
import { createApp } from "./app";

const PORT = process.env.PORT || 7545;

async function main() {
  const { server } = createApp();

  server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(
      `🔌 WebSocket server is ready — connect via ws://<host>:${PORT}`
    );
    console.log(`🛠️ API endpoints available:`);
    console.log(`   - Health check: /health`);
  });

  return async () => {
    console.log("🛑 Shutting down...");

    server.close(() => {
      console.log("✅ HTTP server closed");
    });

    console.log("🔒 Cleaned up resources. Bye!");
  };
}

main()
  .then((shutdown) => {
    const handleExit = async () => {
      await shutdown();
      process.exit(0);
    };
    process.on("SIGINT", handleExit);
    process.on("SIGTERM", handleExit);
  })
  .catch((err) => {
    console.error("❌ Startup failed:", err);
    process.exit(1);
  });
