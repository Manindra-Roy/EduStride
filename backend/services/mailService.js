import nodemailer from 'nodemailer';

/**
 * Get active mail provider name based on configuration and environment
 */
export const getActiveMailProvider = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (isProduction && process.env.BREVO_PASS) {
    return 'Brevo API (Production)';
  }
  if (process.env.BREVO_USER && process.env.BREVO_PASS) {
    return 'Brevo SMTP';
  }
  if (process.env.EMAIL_HOST && process.env.EMAIL_HOST !== 'smtp.ethereal.email') {
    return 'Custom SMTP';
  }
  return 'Ethereal (Mock)';
};

/**
 * Send an email using the active mail provider
 */
export const sendEmail = async ({ from, to, subject, text, html }) => {
  const provider = getActiveMailProvider();

  // If a verified BREVO_SENDER is configured, rewrite the sender email to match the verified domain.
  // This avoids Brevo SMTP/API rejecting the mail due to unverified sender domains.
  let activeFrom = from;
  if (process.env.BREVO_SENDER) {
    const nameMatch = from.match(/"?([^"]*)"?\s*<[^>]*>/);
    const displayName = nameMatch ? nameMatch[1].trim() : 'EduStride Admin';
    activeFrom = `"${displayName}" <${process.env.BREVO_SENDER}>`;
  }

  if (provider === 'Brevo API (Production)') {
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
  }

  // NodeMailer SMTP config setup
  let transporterConfig = {};
  if (provider === 'Brevo SMTP') {
    transporterConfig = {
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.BREVO_USER,
        pass: process.env.BREVO_PASS
      }
    };
  } else if (provider === 'Custom SMTP') {
    transporterConfig = {
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT) || 587,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    };
  } else {
    // Ethereal / Local Mock SMTP setup
    transporterConfig = {
      host: process.env.EMAIL_HOST || 'smtp.ethereal.email',
      port: parseInt(process.env.EMAIL_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER || 'mock_user',
        pass: process.env.EMAIL_PASS || 'mock_password'
      }
    };
  }

  const transporter = nodemailer.createTransport(transporterConfig);
  return await transporter.sendMail({ from: activeFrom, to, subject, text, html });
};

/**
 * Verify current mail configurations
 */
export const verifyMailConfig = async () => {
  const provider = getActiveMailProvider();
  
  try {
    if (provider === 'Brevo API (Production)') {
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

    let transporterConfig = {};
    if (provider === 'Brevo SMTP') {
      transporterConfig = {
        host: 'smtp-relay.brevo.com',
        port: 587,
        secure: false,
        auth: {
          user: process.env.BREVO_USER,
          pass: process.env.BREVO_PASS
        }
      };
    } else if (provider === 'Custom SMTP') {
      transporterConfig = {
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT) || 587,
        secure: process.env.EMAIL_SECURE === 'true',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      };
    } else {
      transporterConfig = {
        host: process.env.EMAIL_HOST || 'smtp.ethereal.email',
        port: parseInt(process.env.EMAIL_PORT) || 587,
        secure: false,
        auth: {
          user: process.env.EMAIL_USER || 'mock_user',
          pass: process.env.EMAIL_PASS || 'mock_password'
        }
      };
    }

    const transporter = nodemailer.createTransport(transporterConfig);
    await transporter.verify();
    return `Operational (${provider})`;
  } catch (err) {
    return `${provider} Offline: ${err.message}`;
  }
};
