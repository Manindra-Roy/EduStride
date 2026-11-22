import React, { createContext, useState, useEffect, useContext, useRef } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(() => {
    const savedToken = localStorage.getItem('token');
    if (savedToken) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${savedToken}`;
    }
    return savedToken || null;
  });
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const skipNextLoadRef = useRef(false);

  const logout = () => {
    delete axios.defaults.headers.common['Authorization'];
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  // Set up global response interceptor for 401 handling
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const reqUrl = error.config?.url || '';
        const isAuthCredentialCheck =
          reqUrl.includes('/api/auth/change-password') ||
          reqUrl.includes('/api/auth/login');
        if (error.response && error.response.status === 401 && !isAuthCredentialCheck) {
          logout();
        }
        return Promise.reject(error);
      }
    );
    return () => {
      axios.interceptors.response.eject(interceptor);
    };
  }, []);

  useEffect(() => {
    const loadUser = async () => {
      if (!token) {
        setLoading(false);
        return;
      }
      if (skipNextLoadRef.current) {
        skipNextLoadRef.current = false;
        setLoading(false);
        return;
      }
      try {
        const response = await axios.get('/api/auth/me');
        if (response.data.success) {
          setUser(response.data.user);
        } else {
          logout();
        }
      } catch (err) {
        console.error('Failed to load user profile', err);
        const status = err.response?.status;
        if (status === 401 || status === 403) {
          logout();
        }
      } finally {
        setLoading(false);
      }
    };
    loadUser();
  }, [token]);

  const login = async (email, password) => {
    try {
      const response = await axios.post('/api/auth/login', { email, password });
      if (response.data.success) {
        const tokenVal = response.data.token;
        axios.defaults.headers.common['Authorization'] = `Bearer ${tokenVal}`;
        localStorage.setItem('token', tokenVal);
        skipNextLoadRef.current = true;
        setUser(response.data.user);
        setToken(tokenVal);
        setLoading(false);
        return { success: true };
      }
      return {
        success: false,
        message: response.data?.message || 'Login failed. Please check credentials.'
      };
    } catch (err) {
      return {
        success: false,
        message: err.response?.data?.message || 'Login failed. Please check credentials.'
      };
    }
  };

  const register = async (email, password, role, class_level, roll_number) => {
    try {
      const payload = { email, password, role };
      if (role === 'Student') {
        payload.class_level = class_level;
        payload.roll_number = roll_number;
      }
      const response = await axios.post('/api/auth/register', payload);
      if (response.data.success) {
        const tokenVal = response.data.token;
        axios.defaults.headers.common['Authorization'] = `Bearer ${tokenVal}`;
        localStorage.setItem('token', tokenVal);
        skipNextLoadRef.current = true;
        setUser(response.data.user);
        setToken(tokenVal);
        setLoading(false);
        return { success: true };
      }
      return {
        success: false,
        message: response.data?.message || 'Registration failed.'
      };
    } catch (err) {
      return {
        success: false,
        message: err.response?.data?.message || 'Registration failed.'
      };
    }
  };

  const updateUserProfilePic = (profile_pic) => {
    setUser(prev => prev ? { ...prev, profile_pic } : null);
  };

  const updateUserThemeColor = (theme_color) => {
    setUser(prev => prev ? { ...prev, theme_color } : null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, updateUserProfilePic, updateUserThemeColor }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
export default AuthContext;
