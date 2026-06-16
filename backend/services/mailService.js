import nodemailer from 'nodemailer';

/**
 * Send an email using the active mail provider
 */
export const sendEmail = async ({ from, to, subject, text, html }) => {
  const isProduction = process.env.NODE_ENV === 'production';

  // If a verified BREVO_SENDER is configured, rewrite the sender email to match the verified domain.
  // This avoids Brevo SMTP/API rejecting the mail due to unverified sender domains.
  let activeFrom = from;
  if (process.env.BREVO_SENDER) {
    const nameMatch = from.match(/"?([^"]*)"?\s*<[^>]*>/);
    const displayName = nameMatch ? nameMatch[1].trim() : 'EduStride Admin';
    activeFrom = `"${displayName}" <${process.env.BREVO_SENDER}>`;
  }

  if (isProduction && process.env.BREVO_PASS) {
    // PRODUCTION: Brevo HTTP API (fetch)
    let senderName = 'EduStride Admin';
    let senderEmail = process.env.BREVO_SENDER || 'admin@edustride.com';
    
    // Parse sender name and email from activeFrom
    const fromMatch = activeFrom.match(/"?([^"]*)"?\s*<([^>]*)>/);
    if (fromMatch) {
      senderName = fromMatch[1].trim();
      senderEmail = fromMatch[2].trim();
    } else if (activeFrom.includes('@')) {
      senderEmail = activeFrom.trim();
    }

    const payload = {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: to }],
      subject: subject,
    };
    
    if (html) payload.htmlContent = html;
    if (text) payload.textContent = text;

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_PASS,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Brevo API Error: ${response.status} - ${errorText}`);
    }

    return await response.json();
  } else {
    // LOCALHOST / DEVELOPMENT: Nodemailer SMTP
    let transporterConfig = {
      host: process.env.EMAIL_HOST || 'smtp.ethereal.email',
      port: parseInt(process.env.EMAIL_PORT) || 587,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER || 'mock_user',
        pass: process.env.EMAIL_PASS || 'mock_password'
      }
    };

    // If local development has Brevo SMTP keys defined, route Nodemailer through Brevo
    if (process.env.BREVO_USER && process.env.BREVO_PASS) {
      transporterConfig = {
        host: 'smtp-relay.brevo.com',
        port: 587,
        secure: false,
        auth: {
          user: process.env.BREVO_USER,
          pass: process.env.BREVO_PASS
        }
      };
    }

    const transporter = nodemailer.createTransport(transporterConfig);
    return await transporter.sendMail({ from: activeFrom, to, subject, text, html });
  }
};

/**
 * Verify current mail configurations
 */
export const verifyMailConfig = async () => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  try {
    if (isProduction && process.env.BREVO_PASS) {
      const response = await fetch('https://api.brevo.com/v3/account', {
        headers: {
          'api-key': process.env.BREVO_PASS
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP status ${response.status}`);
      }

      const data = await response.json();
      return `Operational (Brevo API - ${data.email})`;
    }

    // Localhost SMTP configuration
    let transporterConfig = {
      host: process.env.EMAIL_HOST || 'smtp.ethereal.email',
      port: parseInt(process.env.EMAIL_PORT) || 587,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER || 'mock_user',
        pass: process.env.EMAIL_PASS || 'mock_password'
      }
    };

    if (process.env.BREVO_USER && process.env.BREVO_PASS) {
      transporterConfig = {
        host: 'smtp-relay.brevo.com',
        port: 587,
        secure: false,
        auth: {
          user: process.env.BREVO_USER,
          pass: process.env.BREVO_PASS
        }
      };
    }

    const transporter = nodemailer.createTransport(transporterConfig);
    await transporter.verify();
    return `Operational (Nodemailer SMTP)`;
  } catch (err) {
    return `Mail Service Offline: ${err.message}`;
  }
};
