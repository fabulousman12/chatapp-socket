const express = require('express');
require("dotenv").config();
const mysql = require('mysql2');
const app = express();
const cors = require('cors');
const connectDB = require('./db.js');
const User = require('./models/User.js');
const Message = require('./models/Message.js');
require("dotenv").config();
const uuid = require('uuid');
const url = require('url');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const socketIo = require('socket.io');
const GroupMessage = require('./models/Groupmessage.js');
const JWT_SIGN = process.env.JWTSIGN;
const mysqlPromisePool = require('./Mydb.js'); // Adjust the path as per your project structure

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const corsOptions = {
  
    origin: "*",
    methods: ["GET", "POST",'PUT'],
   
  
};
app.use(cors(corsOptions));

// Connect to Database
connectDB();


// Models
require('./models/User.js');
require('./models/Message.js');
require('./models/Group.js');
require('./models/Groupmessage.js');



// Error Handling
const errorHandler = require("./handler/errorHandler");
app.use(errorHandler.mongoseErrors);

app.use("/user", require('./routes/user'));
app.use("/messages", require('./routes/message'));
app.use("/groups",require('./routes/group'))
app.use("/api",require('./routes/patchUpdate.js'))
app.use(errorHandler.notFound);

if (process.env.ENV === "DEVELOPMENT") {
    app.use(errorHandler.developmentErrors);
} else {
    app.use(errorHandler.productionErrors);
}

// Start the server
const server = app.listen(process.env.PORT, () => {
    console.log("Server listening on port ",process.env.PORT);
});

// WebSocket server setup

const wss = new WebSocket.Server({ server });




function broadcastOnlineUsers() {
  const onlineUsers = [...wss.clients]
    .filter(client => client.readyState === WebSocket.OPEN)
    .map(client => ({ userId: client.userId, username: client.username }));

  const message = JSON.stringify({ type: 'onlineUsers', users: onlineUsers });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Function to send initial messages to a client upon connection
async function sendInitialMessages(ws) {
  try {
    const userId = ws.userId;

    // Fetch distinct users (either sender or recipient) who have interacted with the current user from MySQL
    const query = `
      SELECT DISTINCT sender AS userId
      FROM messages
      WHERE recipient = ?
      UNION
      SELECT DISTINCT recipient AS userId
      FROM messages
      WHERE sender = ?
    `;
    const [distinctUsers, fields] = await mysqlPromisePool.promise().query(query, [userId, userId]);

    // Prepare an array to collect all messages from MySQL
    const allMessagesFromMySQL = [];

    // Iterate through each distinct user pair and fetch up to 30 messages for each pair from MySQL
    for (const otherUser of distinctUsers) {
      const otherUserId = otherUser.userId;

      const messagesQuery = `
        SELECT *
        FROM messages
        WHERE (sender = ? AND recipient = ?)
          OR (sender = ? AND recipient = ?)
        ORDER BY timestamp DESC
        LIMIT 30
      `;
      const [messages, msgFields] = await mysqlPromisePool.promise().query(messagesQuery, [userId, otherUserId, otherUserId, userId]);

      // Push fetched messages to the array
      allMessagesFromMySQL.push(...messages);
    }

    // Prepare the final message to send
    const message = JSON.stringify({
      type: 'initialMessages',
      messages: allMessagesFromMySQL  // Send MySQL messages to the client
    });

    // Send the message to the client
    ws.send(message);
  } catch (error) {
    console.error('Error sending initial messages:', error);
  }
}


////On sending messages
wss.on('connection', async (ws, req) => {
  const query = url.parse(req.url, true).query;
  const token = query.token;
 

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SIGN);
      const userId = decoded.user.id;
      const user = await User.findById(userId).select("-password");

      if (user) {
        ws.userId = user.id;
        ws.username = user.name;
   
        broadcastOnlineUsers();
       
        sendInitialMessages(ws);  // Send initial messages upon connection
      } else {
        ws.close();
      }
    } catch (error) {
      ws.close();
    }
  } else {
    ws.close();
  }

  ws.on('message', async (message) => {
    const messageData = JSON.parse(message.toString());
    const decoded = jwt.verify(token, JWT_SIGN);
    const userId = decoded.user.id;
    const user = await User.findById(userId).select("-password");

    
    const { recipient, content } = messageData;
    const sender = user.id;
    const messageId = uuid.v4();

    if (recipient) {
      const newMessage = new Message({
        sender: sender,
        recipient,
        content,
        timestamp: new Date(),
        status: 'pending',
        read:false
      });
     
       await saveMessageToMySQL(sender, recipient, content,messageId);

console.log(messageId)
      

      wss.clients.forEach(client => {
        if (client.userId === recipient && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'message',
            sender: sender,
            content,
            recipient,
            status: 'sent',
            read:false,
            id: messageId,
            timestamp: new Date()
          }));
          newMessage.status = 'sent';
        }
      });

      
      

      await newMessage.save();
    }
  });



  ws.on('close', () => {
    broadcastOnlineUsers();
  });
});

async function saveMessageToMySQL(sender, recipient, content,messageId) {
 
  const insertQuery = `
    INSERT INTO messages (id, sender, recipient, content, timestamp, status, \`read\`)
    VALUES (?, ?, ?, ?, NOW(), 'pending', 0)
  `;

  try {
    const [insertResult] = await mysqlPromisePool.promise().query(insertQuery, [messageId, sender, recipient, content]);
    
    return insertResult.insertId;
  } catch (error) {
    console.error('Error inserting message:', error);
    throw error; // Propagate the error to handle it elsewhere if needed
  }
}


module.exports = app;
