# Marco's Mowing ERP

Marco's Mowing is a comprehensive, real-time Enterprise Resource Planning (ERP) web application designed specifically for managing landscaping crews, fleet maintenance, and operational performance.

## Features

- **Dynamic Scheduling:** Drag-and-drop interface to manage daily crews, assign vehicles, and track personnel.
- **Mechanic Master:** Kanban-style board for logging vehicle repairs, tracking statuses (In Repair vs. Out of Service), and monitoring CVOR expirations.
- **Performance Tracking:** Log and compare Booked Hours vs. Actual Hours to calculate daily job efficiency.
- **Bulletin Board:** A centralized communication hub for managers to post announcements and updates for the team.
- **Live Weather Integration:** Real-time weather forecasting powered by the Open-Meteo API.
- **Secure Authentication:** Built-in role-based access control (Admin vs. Employee) powered by Firebase Auth.
- **MCP AI Integration:** The project includes a local Model Context Protocol (MCP) server that connects the live Firebase database directly to AI assistants.

## Tech Stack

- **Frontend:** React, Vite, Tailwind CSS
- **Icons:** Lucide React
- **Backend/Database:** Google Firebase (Firestore & Authentication)
- **AI Integration:** MCP (Model Context Protocol) via Firebase Admin SDK

## Setup & Local Development

1. **Install Dependencies:**
   Ensure you have Node.js installed, then run:
   ```bash
   npm install
   ```

2. **Start Development Server:**
   ```bash
   npm run dev
   ```
   The application will be available at `http://localhost:5173/`.

## Security

This repository is configured to ignore sensitive files. Ensure that your `serviceAccountKey.json` and any local `.env` files containing your Firebase credentials are never committed to version control.
