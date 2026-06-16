import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const PageTitleUpdater = () => {
  const location = useLocation();

  useEffect(() => {
    let title = 'EduStride ERP & LMS';
    const path = location.pathname;

    if (path === '/') {
      title = 'Dashboard | EduStride ERP & LMS';
    } else if (path.startsWith('/class/')) {
      const parts = path.split('/');
      const classLevel = parts[parts.length - 1];
      title = `Class ${classLevel || ''} Classroom | EduStride`;
    } else if (path === '/fees') {
      title = 'Tuition Fee Ledger | EduStride';
    } else if (path === '/lms') {
      title = 'LMS Download Center | EduStride';
    } else if (path === '/chats') {
      title = 'Classroom Real-time Chats | EduStride';
    } else if (path === '/register') {
      title = 'Provision Academic Users | EduStride';
    } else if (path === '/automations') {
      title = 'System Automations & Logs | EduStride';
    } else if (path === '/login') {
      title = 'Sign In | EduStride ERP & LMS';
    }

    document.title = title;
  }, [location]);

  return null;
};

export default PageTitleUpdater;
