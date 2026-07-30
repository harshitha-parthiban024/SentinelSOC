import "dotenv/config";
import mongoose from "mongoose";

const MONGO_URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/sentinel_soc";
const MONGO_DB_NAME = process.env.MONGODB_DB_NAME ?? undefined;

let connecting: Promise<typeof mongoose> | null = null;

/**
 * Lazily opens (and memoizes) the Mongoose connection. Safe to call from
 * every server route/handler — subsequent calls resolve instantly once
 * connected.
 */
export function connectMongo(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose);
  if (!connecting) {
    connecting = mongoose
      .connect(MONGO_URI, { dbName: MONGO_DB_NAME })
      .then((m) => {
        console.log(`[mongo] connected -> ${m.connection.name}`);
        return m;
      })
      .catch((err) => {
        connecting = null;
        console.error("[mongo] connection failed", err);
        throw err;
      });

    mongoose.connection.on("error", (err) => {
      console.error("[mongo] connection error", err);
    });
    mongoose.connection.on("disconnected", () => {
      console.warn("[mongo] disconnected");
    });
  }
  return connecting;
}
