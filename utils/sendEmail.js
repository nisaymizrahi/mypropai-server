const nodemailer = require('nodemailer');

const sendEmail = async (options) => {
  // 1. Create a transporter object using SendGrid
  const transporter = nodemailer.createTransport({
    host: 'smtp.sendgrid.net',
    port: 587,
    auth: {
      user: 'apikey', // This is the literal string 'apikey' for SendGrid
      pass: process.env.SENDGRID_API_KEY,
    },
  });

  // 2. Define the email options
  const mailOptions = {
    from: options.from || `Fliprop <${process.env.EMAIL_FROM}>`,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    replyTo: options.replyTo,
    headers: options.headers,
  };

  // 3. Actually send the email
  try {
    await transporter.sendMail(mailOptions);
    console.log('Email sent successfully');
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};

module.exports = sendEmail;
