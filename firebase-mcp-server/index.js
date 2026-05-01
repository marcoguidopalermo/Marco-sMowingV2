#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");
if (!fs.existsSync(serviceAccountPath)) {
  console.error("Error: serviceAccountKey.json not found in " + __dirname);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Create MCP Server
const server = new Server(
  {
    name: "crewmaster-firebase-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_firestore",
        description: "Read a document from Firestore",
        inputSchema: {
          type: "object",
          properties: {
            collection: { type: "string", description: "The Firestore collection name" },
            documentId: { type: "string", description: "The document ID to read" },
          },
          required: ["collection", "documentId"],
        },
      },
      {
        name: "write_firestore",
        description: "Write or update a document in Firestore",
        inputSchema: {
          type: "object",
          properties: {
            collection: { type: "string", description: "The Firestore collection name" },
            documentId: { type: "string", description: "The document ID to write to" },
            data: { type: "object", description: "The JSON data to write" },
            merge: { type: "boolean", description: "Whether to merge with existing data (true) or overwrite completely (false)" },
          },
          required: ["collection", "documentId", "data"],
        },
      },
    ],
  };
});

// Handle Tool Execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "read_firestore") {
    const { collection, documentId } = args;
    try {
      const docRef = db.collection(collection).doc(documentId);
      const docSnap = await docRef.get();
      
      if (!docSnap.exists) {
        return { content: [{ type: "text", text: `Document ${documentId} does not exist in collection ${collection}.` }] };
      }
      
      return { content: [{ type: "text", text: JSON.stringify(docSnap.data(), null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error reading Firestore: ${error.message}` }], isError: true };
    }
  }

  if (name === "write_firestore") {
    const { collection, documentId, data, merge = true } = args;
    try {
      const docRef = db.collection(collection).doc(documentId);
      await docRef.set(data, { merge });
      return { content: [{ type: "text", text: `Successfully wrote to ${collection}/${documentId}.` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error writing Firestore: ${error.message}` }], isError: true };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Start Server
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Firebase MCP Server running on stdio");
}

run().catch(console.error);
