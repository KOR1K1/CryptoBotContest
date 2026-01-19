#!/bin/bash
set -e

echo "Waiting for MongoDB to be ready..."
sleep 5

echo "Initializing MongoDB replica set..."
mongosh --host mongo:27017 <<EOF
try {
  rs.initiate({
    _id: "rs0",
    members: [
      { _id: 0, host: "mongo:27017" }
    ]
  });
  print("Replica set initialized successfully");
} catch (e) {
  if (e.message.includes("already initialized")) {
    print("Replica set already initialized");
  } else {
    throw e;
  }
}
EOF

echo "MongoDB replica set setup complete"

