const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const fetchuser = require('../middleware/fetchuser');
require("dotenv").config();
const uploadMiddleware = require('../middleware/upload');
const JWT_SIGN = process.env.JWTSIGN;
const mysqlPromisePool = require('../Mydb.js');



// Route 1: Create a user using POST "user/createuser". Does not require auth
router.post('/createuser', uploadMiddleware, [
  body('email', 'Enter a valid email').isEmail(),
  body('username', 'Enter a valid username').isLength({ min: 3 }),
  body('password', 'Password must be longer than 6 characters').isLength({ min: 6 })
], async (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, username, password,phoneNumber } = req.body;

  try {
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ error: "User already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const secPassword = await bcrypt.hash(password, salt);
    const profilePhoto = req.file ? {
      data: req.file.buffer,
      contentType: req.file.mimetype
    } : null;

    user = new User({
      email,
      name:username,
      password: secPassword,
      phoneNumber,
      profilePhoto, // Save the image buffer if uploaded
    });

    await user.save();

    const payload = {
      user: {
        id: user.id
      }
    };

    const authtoken = jwt.sign(payload, JWT_SIGN);
    res.json({ authtoken });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Route 2: Edit user details using PUT "/api/auth/edituser". Login required
router.put('/edituser', fetchuser,uploadMiddleware, async (req, res) => {

  
  const { email, name, password } = req.body;

  const profilepic = req.file;
  


  try {
    let user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (email) {
      user.email = email;
    }
    if (profilepic) {
      
      user.profilePhoto = {
        data: req.file.buffer,
        contentType: req.file.mimetype
      };
    }
    if (name) {
      user.name = name;
    }
    if (password) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);
    }


    await user.save();

    res.json({ success: true, message: "User details updated successfully" } );


  } catch (error) {
    console.error('Error editing user:', error);
    res.status(500).json(error );
  }
});


// Route 2: Authenticate user using POST "api/auth/login"
router.post('/login', [
  body('email', 'Enter a valid email').isEmail(),
  body('password', 'Password should not be blank').exists()
], async (req, res) => {
  const errors = validationResult(req);
  let success = false;

  // If there are validation errors, return bad request and errors
  if (!errors.isEmpty()) {
    return res.status(400).json({ success, errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    let user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ success, error: "Invalid credentials" });
    }

    const passCompare = await bcrypt.compare(password, user.password);
    if (!passCompare) {
      return res.status(400).json({ success, error: "Invalid credentials" });
    }

    const payload = {
      user: {
        id: user.id
      }
    };

    const authtoken = jwt.sign(payload, JWT_SIGN);
    success = true;

    // Send response with token
    res.json({ success, authtoken });
  } catch (error) {
    console.error('Error logging in user:', error);
    res.status(500).json({ success, error: "Internal Server Error" });
  }
});

// Route 3: Get logged-in user details using POST "/api/auth/getuser". Login required
router.post('/getuser', fetchuser, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select("-password");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const userResponse = {
      name: user.name,
      profilePhoto: user.profilePhoto 
        ? `data:${user.profilePhoto.contentType};base64,${user.profilePhoto.data.toString('base64')}` 
        : null,
        phoneNumber:user.phoneNumber,
        email:user.email,

      // Add other user details you want to include in the response
    };
    res.json(userResponse);
    
  } catch (error) {
    console.error('Error fetching user details:', error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get('/alluser', fetchuser, async (req, res) => {
  try {
    const currentUserID = req.user.id;

    // Step 1: Fetch distinct sender and recipient IDs from MySQL messages table
    const [senders] = await mysqlPromisePool.promise().query('SELECT DISTINCT sender FROM messages WHERE recipient = ?', [currentUserID]);
    const [recipients] = await mysqlPromisePool.promise().query('SELECT DISTINCT recipient FROM messages WHERE sender = ?', [currentUserID]);

    // Combine sender and recipient IDs, excluding current user's ID
    const userIds = [
      ...new Set([...senders.map(row => row.sender), ...recipients.map(row => row.recipient)])
    ].filter(id => id !== currentUserID); // Exclude current user's ID from the list

    // Step 2: Fetch users from MongoDB using userIds
    const users = await User.find({ _id: { $in: userIds } });

    // Step 3: Format user details
    const userDetails = users.map(user => ({
      id: user._id,
      name: user.name,
      profilePic: user.profilePhoto ? `data:${user.profilePhoto.contentType};base64,${user.profilePhoto.data.toString('base64')}` : null,
      phoneNumber: user.phoneNumber
    }));
    

    // Step 4: Send the response with filtered user details
    res.json(userDetails);
  } catch (error) {
    console.error('Error fetching users with messages:', error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


router.post('/existsuser', fetchuser,async (req, res) => {
  const phoneNumber = req.body.phoneNumber;
 

  try {
    // Search for a user by phoneNumber
    const user = await User.findOne({ phoneNumber });

    if (!user) {
      return res.status(303).json({status:false});
    }


    // Prepare user details to return
    const userDetails = {
      id: user._id,
      name: user.name,
      profilePic: user.profilePhoto ? `data:${user.profilePhoto.contentType};base64,${user.profilePhoto.data.toString('base64')}` : null,
      phoneNumber: user.phoneNumber
    };

    res.json({status:true,userDetails});
  } catch (error) {
    console.error('Error fetching user by phone number:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
