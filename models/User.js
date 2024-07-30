const mongoose = require("mongoose")
const userSchema = new mongoose.Schema({
    name:{
        type:String,
        required:'Name is required'
    },
    email:{
        type:String,
        required:true,
        unique:true,
    },
    password:{
        type:String,
        required:true
    },
    phoneNumber: { type: String, required: true, unique: true },
    profilePhoto: { data: Buffer, contentType: String } ,
    contacts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
},{
    timestamps:true
});

module.exports = mongoose.model("User",userSchema)