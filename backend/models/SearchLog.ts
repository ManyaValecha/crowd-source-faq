import mongoose, { Document, Schema as MongooseSchema, Types } from 'mongoose';

// Top result source enum
export type ResultSource = 'faq' | 'community' | null;

// Interface for the SearchLog document
export interface ISearchLog extends Document {
  query: string;
  resultsCount: number;
  topResultId: Types.ObjectId | null;
  topResultSource: ResultSource;
  // v1.68 — M1: add userId so the admin User Activity chart
  // can show unique user counts (not just search count).
  // Optional for anonymous searches (no req.user); required
  // for logged-in searches.
  userId?: Types.ObjectId | null;
}

// Schema designed to track user search behavior for analytics and trending topics
const searchLogSchema = new MongooseSchema(
  {
    query: {
      type: String,
      required: true,
      trim: true, // The exact search term the user entered
    },
    resultsCount: {
      type: Number,
      default: 0, // Tracks how many items were returned (useful for spotting "dead end" searches)
    },
    topResultId: {
      type: MongooseSchema.Types.ObjectId,
      default: null, // Stores the ID of the highest-ranked result to measure click/relevance potential
    },
    topResultSource: {
      type: String,
      enum: ['faq', 'community', 'knowledge', null] as ResultSource[], // Identifies whether the best answer came from official FAQs, user posts, or the auto-extracted knowledge base
      default: null,
    },
    // v1.68 — M1
    userId: {
      type: MongooseSchema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true, // for the user-activity aggregation
    },
  },
  { timestamps: true } // Automatically records exactly when the search happened via 'createdAt'
);

// Export the model, explicitly defining the target collection name ('yaksha_faq_searchlogs')
export default mongoose.model<ISearchLog>('SearchLog', searchLogSchema, 'yaksha_faq_searchlogs');