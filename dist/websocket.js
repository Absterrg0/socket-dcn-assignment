"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = __importStar(require("ws"));
const http_1 = __importDefault(require("http"));
const uuid_1 = require("uuid"); // You'll need to install this: npm install uuid @types/uuid
const server = http_1.default.createServer();
const wss = new ws_1.WebSocketServer({ server });
// Default room that all users will join
const DEFAULT_ROOM_ID = 'default-room';
const DEFAULT_ROOM_NAME = 'Main Chat Room';
// Create the default room
const activeRooms = {
    [DEFAULT_ROOM_ID]: {
        id: DEFAULT_ROOM_ID,
        name: DEFAULT_ROOM_NAME,
        clients: new Map(),
        messages: []
    }
};
// Track client state
const clientStates = new WeakMap();
// Max messages to store per room
const MAX_MESSAGES_PER_ROOM = 100;
wss.on('connection', (ws) => {
    console.log('Client connected');
    // Initialize client state
    clientStates.set(ws, {
        userId: null,
        userName: null,
        currentRoom: null
    });
    ws.on('message', (message) => {
        let msg;
        try {
            msg = JSON.parse(message.toString());
        }
        catch (error) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid JSON' }));
            return;
        }
        if (!msg.type) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Message type is required' }));
            return;
        }
        const clientState = clientStates.get(ws);
        if (!clientState) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Client state not found' }));
            return;
        }
        switch (msg.type) {
            case 'SET_USER':
                if (!msg.userId) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'User ID is required' }));
                    return;
                }
                // Save both userId and userName
                clientState.userId = msg.userId;
                clientState.userName = msg.userName || `User-${msg.userId.substring(0, 5)}`;
                ws.send(JSON.stringify({
                    type: 'USER_SET',
                    userId: clientState.userId,
                    userName: clientState.userName
                }));
                break;
            case 'JOIN_ROOM':
                if (!msg.roomId) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Room ID is required' }));
                    return;
                }
                if (!clientState.userId) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Set user ID before joining a room' }));
                    return;
                }
                // Check if requested room exists, otherwise use default room
                const roomId = activeRooms[msg.roomId] ? msg.roomId : DEFAULT_ROOM_ID;
                const room = activeRooms[roomId];
                // Leave current room if in one
                leaveCurrentRoom(ws, clientState);
                // Join new room
                room.clients.set(ws, {
                    userId: clientState.userId,
                    userName: clientState.userName || `User-${clientState.userId.substring(0, 5)}`
                });
                clientState.currentRoom = roomId;
                // Notify all clients in the room about the new user
                broadcastToRoom(room, {
                    type: 'USER_JOINED',
                    userId: clientState.userId,
                    userName: clientState.userName,
                    timestamp: new Date().toISOString()
                });
                // Send room joined confirmation with room info
                ws.send(JSON.stringify({
                    type: 'ROOM_JOINED',
                    roomId: roomId,
                    name: room.name
                }));
                // Send list of current users in the room
                const roomUsers = getRoomUsers(roomId);
                ws.send(JSON.stringify({
                    type: 'ROOM_USERS',
                    users: roomUsers
                }));
                // Send recent messages history
                if (room.messages.length > 0) {
                    ws.send(JSON.stringify({
                        type: 'MESSAGE_HISTORY',
                        messages: room.messages
                    }));
                }
                break;
            case 'CHAT_MESSAGE':
                if (!msg.content) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Message content is required' }));
                    return;
                }
                if (!clientState.userId) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Set user ID before sending messages' }));
                    return;
                }
                if (!clientState.currentRoom) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Join a room before sending messages' }));
                    return;
                }
                const targetRoom = activeRooms[clientState.currentRoom];
                if (targetRoom) {
                    // Create a new message object
                    const newMessage = {
                        id: msg.id || (0, uuid_1.v4)(),
                        content: msg.content,
                        senderId: clientState.userId,
                        senderName: msg.senderName || clientState.userName || `User-${clientState.userId.substring(0, 5)}`,
                        timestamp: msg.timestamp || new Date().toISOString(),
                        roomId: clientState.currentRoom
                    };
                    // Store message in room history (limited to max messages)
                    targetRoom.messages.push(newMessage);
                    if (targetRoom.messages.length > MAX_MESSAGES_PER_ROOM) {
                        targetRoom.messages.shift(); // Remove oldest message
                    }
                    // Broadcast message to all users in the room
                    broadcastToRoom(targetRoom, {
                        type: 'CHAT_MESSAGE',
                        id: newMessage.id,
                        content: newMessage.content,
                        senderId: newMessage.senderId,
                        senderName: newMessage.senderName,
                        timestamp: newMessage.timestamp
                    });
                }
                else {
                    // Room no longer exists
                    clientState.currentRoom = null;
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found, please join a room again' }));
                }
                break;
            case 'LEAVE_ROOM':
                if (clientState.currentRoom) {
                    leaveCurrentRoom(ws, clientState);
                    ws.send(JSON.stringify({ type: 'ROOM_LEFT' }));
                }
                else {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Not in a room' }));
                }
                break;
            default:
                ws.send(JSON.stringify({ type: 'ERROR', message: 'Unknown message type' }));
        }
    });
    ws.on('close', () => {
        console.log('Client disconnected');
        const clientState = clientStates.get(ws);
        if (clientState) {
            leaveCurrentRoom(ws, clientState);
            clientStates.delete(ws);
        }
    });
    // Helper function to leave current room
    function leaveCurrentRoom(ws, state) {
        if (state.currentRoom && activeRooms[state.currentRoom]) {
            const room = activeRooms[state.currentRoom];
            // Get user details before removing from room
            const userDetails = room.clients.get(ws);
            room.clients.delete(ws);
            // Notify remaining users about the departure
            if (state.userId && userDetails) {
                broadcastToRoom(room, {
                    type: 'USER_LEFT',
                    userId: state.userId,
                    userName: userDetails.userName,
                    timestamp: new Date().toISOString()
                });
            }
            // Don't delete the default room even if empty
            if (state.currentRoom !== DEFAULT_ROOM_ID && room.clients.size === 0) {
                delete activeRooms[state.currentRoom];
                console.log(`Room ${state.currentRoom} deleted (empty)`);
            }
            state.currentRoom = null;
        }
    }
    // Helper function to broadcast a message to all clients in a room
    function broadcastToRoom(room, message) {
        const messageStr = JSON.stringify(message);
        room.clients.forEach((userDetails, client) => {
            if (client.readyState === ws_1.default.OPEN) {
                client.send(messageStr);
            }
        });
    }
    // Helper function to get all users in a room
    function getRoomUsers(roomId) {
        const room = activeRooms[roomId];
        if (!room)
            return [];
        const users = [];
        room.clients.forEach((userDetails) => {
            users.push({
                id: userDetails.userId,
                name: userDetails.userName
            });
        });
        return users;
    }
});
server.listen(8080, () => {
    console.log('WebSocket server started on port 8080');
});
