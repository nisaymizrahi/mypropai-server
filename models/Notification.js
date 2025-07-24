const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  link: {
    type: String, // e.g. `/investments/:id/tasks`
    default: '',
  },
  read: {
    type: Boolean,
    default: false,
  },
  type: {
    type: String,
    enum: ['reminder', 'system', 'task', 'alert'],
    default: 'system',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Notification', notificationSchema);
