const cron = require('node-cron');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const ProjectTask = require('../models/ProjectTask');
const Investment = require('../models/Investment');
const User = require('../models/User');
const Notification = require('../models/Notification');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const smsClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);

// Format today at 00:00
const getToday = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
};

// ⏰ Run every morning at 8:00 AM
cron.schedule('0 8 * * *', async () => {
  console.log('⏰ Running daily task reminder job...');

  const today = getToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  try {
    const tasks = await ProjectTask.find({
      reminderOn: { $gte: today, $lt: tomorrow },
    }).populate('investment');

    for (const task of tasks) {
      const user = await User.findById(task.investment.user);
      if (!user) continue;

      const message = `Reminder: "${task.title}" is scheduled today for project at ${task.investment.address}`;

      // ✅ In-app Notification
      await Notification.create({
        user: user._id,
        message,
        link: `/investments/${task.investment._id}`,
        type: 'reminder',
      });

      // ✅ Email Reminder
      if (user.email) {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: user.email,
          subject: `Task Reminder: ${task.title}`,
          html: `<p>${message}</p>`,
        });
      }

      // ✅ SMS (Optional)
      if (user.phone && process.env.TWILIO_PHONE) {
        await smsClient.messages.create({
          body: message,
          from: process.env.TWILIO_PHONE,
          to: user.phone, // Must be in E.164 format e.g. +12125551234
        });
      }
    }

    console.log(`✅ Task reminders sent for ${tasks.length} tasks.`);
  } catch (err) {
    console.error("❌ Reminder job failed:", err);
  }
});
