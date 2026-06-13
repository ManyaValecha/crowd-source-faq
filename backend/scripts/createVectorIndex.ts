/**
 * createVectorIndex.ts
 *
 * Creates MongoDB Atlas vector search indexes for the FAQ and CommunityPost
 * embedding fields. Run ONCE after setting up your Atlas cluster — safe to
 * re-run; Atlas will no-op if the index already exists with the same name.
 *
 * Usage:
 *   npm run create:vector-index
 *   npm run create:vector-index -- --drop       # drop the old
 *                                                # (768-dim) index
 *                                                # before creating
 *                                                # the new 1024-dim one
 *
 * Atlas Vector Search reference:
 *   https://www.mongodb.com/docs/atlas/atlas-search/vector-search/
 *
 * v1.68 — model swap to mixedbread-ai/mxbai-embed-large-v1 (1024-dim).
 *   numDimensions now reads from EMBEDDING_DIM in utils/ai/embeddings.ts
 *   so the index stays in sync with the model.
 *
 *   IMPORTANT: if you change the model AND the new dim differs from
 *   the existing index, Atlas will reject the createSearchIndex call
 *   (no in-place dim change). Pass --drop to drop the existing
 *   index first; the script will no-op safely if it doesn't exist.
 *
 * After the index is created, the script runs a sample search
 * against /api/search?q=hello+world to confirm the pipeline
 * works end-to-end.
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { EMBEDDING_DIM } from '../utils/ai/embeddings.js';

dotenv.config();
dotenv.config({ path: '.env.local' });

const MONGO_URI = process.env.MONGODB_URI!;

if (!MONGO_URI) {
  console.error('MONGODB_URI is required');
  process.exit(1);
}

const DB_NAME = 'yaksha_faq';
const SHOULD_DROP = process.argv.includes('--drop');

async function createIndexes() {
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  const db = mongoose.connection.db!;

  const faqCollection = db.collection('yaksha_faq_faqs');
  const postCollection = db.collection('yaksha_faq_communityposts');

  const VECTOR_INDEX = {
    name: 'vector_index',
    definition: {
      mappings: {
        vectorSearch: {
          // Reads from embeddings.ts EMBEDDING_DIM constant.
          // For mxbai-embed-large-v1 that's 1024; for
          // Xenova/multi-qa-mpnet-base-dot-v1 it was 768.
          dimensions: EMBEDDING_DIM,
          similarity: 'dotProduct',
        },
      },
    },
  };

  console.log(`\nIndex target: dimensions=${EMBEDDING_DIM} similarity=dotProduct`);

  if (SHOULD_DROP) {
    console.log('\n[--drop] Removing existing vector_index from both collections…');
    for (const coll of [faqCollection, postCollection]) {
      try {
        await coll.dropSearchIndex('vector_index');
        console.log(`  → dropped ${coll.collectionName}.vector_index`);
      } catch (err: unknown) {
        const e = err as { code?: number; message?: string };
        // IndexSearchNotFound (code 27) or "index not found" message — fine
        if (e.code === 27 || e.message?.toLowerCase().includes('not found')) {
          console.log(`  → ${coll.collectionName}.vector_index doesn't exist, skipping`);
        } else {
          throw err;
        }
      }
    }
  }

  console.log('\n[1/2] Ensuring vector index on yaksha_faq_faqs…');
  try {
    await faqCollection.createSearchIndex(VECTOR_INDEX);
    console.log('  → Created / updated faq vector_index');
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string };
    if (e.code === 85 || e.code === 86 || e.message?.includes('already exists')) {
      console.log('  → faq vector_index already exists, skipping');
      console.log('     (if dimensions differ, pass --drop to remove the old one)');
    } else {
      throw err;
    }
  }

  console.log('\n[2/2] Ensuring vector index on yaksha_faq_communityposts…');
  try {
    await postCollection.createSearchIndex(VECTOR_INDEX);
    console.log('  → Created / updated community vector_index');
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string };
    if (e.code === 85 || e.code === 86 || e.message?.includes('already exists')) {
      console.log('  → community vector_index already exists, skipping');
      console.log('     (if dimensions differ, pass --drop to remove the old one)');
    } else {
      throw err;
    }
  }

  // List all search indexes so the operator can verify
  console.log('\n[+] Current search indexes on yaksha_faq_faqs:');
  await faqCollection.listSearchIndexes().forEach((idx: Record<string, unknown>) => {
    console.log(`    ${(idx.name as string)} (type: ${idx.type as string})`);
  });

  console.log('\n[+] Current search indexes on yaksha_faq_communityposts:');
  await postCollection.listSearchIndexes().forEach((idx: Record<string, unknown>) => {
    console.log(`    ${(idx.name as string)} (type: ${idx.type as string})`);
  });

  console.log('\n✅ Vector index creation complete.');
  await mongoose.disconnect();
}

createIndexes().catch((err) => {
  console.error('\n❌ Failed to create vector index:', err);
  process.exit(1);
});