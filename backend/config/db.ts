// Import Mongoose to interact with MongoDB
import mongoose, { Connection } from 'mongoose';
import { dbLog } from '../utils/http/logger.js';

// Cache connection in serverless environment
let cachedConnection: Connection | null = null;

// v1.67 — Wire mongoose's connection event listeners so we get
// DISCORD-pinging ALERTS on disconnect / reconnection, not just
// console.error noise. `connected` and `disconnected` are
// lifecycle events; `error` is for protocol-level failures.
mongoose.connection.on('connected', () => {
  dbLog.info('connection established', { host: mongoose.connection.host });
});
mongoose.connection.on('disconnected', () => {
  dbLog.alert('disconnected', {
    readyState: mongoose.connection.readyState,
    host: mongoose.connection.host,
  });
});
mongoose.connection.on('reconnected', () => {
  dbLog.info('reconnected', { host: mongoose.connection.host });
});
mongoose.connection.on('error', (err: Error) => {
  dbLog.alert('connection error', { message: err.message });
});

// Async function to handle the database connection
const connectDB = async (): Promise<Connection> => {
  if (cachedConnection) {
    return cachedConnection;
  }

  if (!process.env.MONGODB_URI) {
    dbLog.alert('MONGODB_URI missing at startup', { nodeEnv: process.env.NODE_ENV });
    throw new Error('MONGODB_URI environment variable is missing');
  }

  try {
    // Connect using the URI from environment variables with a 5-second timeout
    cachedConnection = (await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    })).connection;

    dbLog.info('connected at startup', { host: cachedConnection.host });
    return cachedConnection;
  } catch (error) {
    const err = error as Error;
    dbLog.alert('connection failed at startup', { message: err.message });
    throw error;
  }
};

// Export the function to be called in your main server file (e.g., server.js or index.js)
export default connectDB;