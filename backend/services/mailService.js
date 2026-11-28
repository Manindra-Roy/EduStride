import nodemailer from 'nodemailer';

let pooledTransporter = null;

const getSmtpTransporter = () => {
  if (!pooledTransporter) {
    pooledTransporter = nodemailer.createTransport({
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      host: process.env.EMAIL_HOST || 'smtp.ethereal.email',
      port: parseInt(process.env.EMAIL_PORT, 10) || 587,
      secure: process.env.EMAIL_SECURE === 'true',
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: {
        user: process.env.EMAIL_USER || 'mock_user',
        pass: process.env.EMAIL_PASS || 'mock_password'
      }
    });
  }
  return pooledTransporter;
};

/**
 * Send an email using the active mail provider
 */
export const sendEmail = async ({ from, to, subject, text, html }) => {
  const isProduction = process.env.NODE_ENV === 'production';

  const recipients = (Array.isArray(to) ? to : [to])
    .filter(addr => typeof addr === 'string' && addr.trim().length > 0)
    .map(addr => addr.trim());

  if (recipients.length === 0) {
    throw new Error('At least one recipient email address is required.');
  }

  const rawFrom = typeof from === 'string' && from.trim()
    ? from.trim()
    : `"EduStride Admin" <${process.env.BREVO_SENDER || 'admin@edustride.com'}>`;

  // If a verified BREVO_SENDER is configured, rewrite the sender email to match the verified domain.
  // This avoids Brevo SMTP/API rejecting the mail due to unverified sender domains.
  let activeFrom = rawFrom;
  if (process.env.BREVO_SENDER) {
    const nameMatch = rawFrom.match(/"?([^"]*)"?\s*<[^>]*>/);
    const displayName = nameMatch ? nameMatch[1].trim() : 'EduStride Admin';
    activeFrom = `"${displayName}" <${process.env.BREVO_SENDER}>`;
  }

  if (isProduction) {
    if (!process.env.BREVO_PASS) {
      throw new Error('BREVO_PASS is missing in production environment variables.');
    }
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
      to: recipients.map(email => ({ email })),
      subject: subject
    };

    if (html) payload.htmlContent = html;
    if (text) payload.textContent = text;

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': process.env.BREVO_PASS,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Brevo API Error: ${response.status} - ${errorText}`);
    }

    return await response.json();
  } else {
    // LOCALHOST / DEVELOPMENT: Pooled Nodemailer SMTP
    const transporter = getSmtpTransporter();
    return await transporter.sendMail({
      from: activeFrom,
      to: recipients.length === 1 ? recipients[0] : recipients,
      subject,
      text,
      html
    });
  }
};

/**
 * Verify current mail configurations
 */
export const verifyMailConfig = async () => {
  const isProduction = process.env.NODE_ENV === 'production';

  try {
    if (isProduction) {
      if (!process.env.BREVO_PASS) {
        throw new Error('BREVO_PASS is missing in production environment variables.');
      }
      const response = await fetch('https://api.brevo.com/v3/account', {
        headers: {
          'api-key': process.env.BREVO_PASS
        },
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        throw new Error(`HTTP status ${response.status}`);
      }

      return 'Operational (Brevo API)';
    }

    // Localhost SMTP configuration
    const transporter = getSmtpTransporter();
    await transporter.verify();
    return 'Operational (Nodemailer SMTP)';
  } catch (err) {
    return `Mail Service Offline: ${err.message}`;
  }
};
