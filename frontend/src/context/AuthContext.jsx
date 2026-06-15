import React, { createContext, useState, useEffect, useContext } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [loading, setLoading] = useState(true);

  // Configure global axios interceptor for API calls
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  useEffect(() => {
    const loadUser = async () => {
      if (!token) {
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
        logout();
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
        localStorage.setItem('token', response.data.token);
        setToken(response.data.token);
        setUser(response.data.user);
        return { success: true };
      }
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
        localStorage.setItem('token', response.data.token);
        setToken(response.data.token);
        setUser(response.data.user);
        return { success: true };
      }
    } catch (err) {
      return {
        success: false,
        message: err.response?.data?.message || 'Registration failed.'
      };
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  const updateUserProfilePic = (profile_pic) => {
    setUser(prev => prev ? { ...prev, profile_pic } : null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, updateUserProfilePic }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
export default AuthContext;
