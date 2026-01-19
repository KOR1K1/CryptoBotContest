// MongoDB initialization script
// This file runs when MongoDB container starts for the first time

db = db.getSiblingDB('auction_db');

// Create collections with validation (optional, can be done in code)
print('MongoDB initialized for auction_db');

