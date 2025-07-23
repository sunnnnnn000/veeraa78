import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { User as SupabaseUser } from '@supabase/supabase-js';

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dateOfBirth?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (firstName: string, lastName: string, email: string, phone: string, password: string) => Promise<void>;
  updateUser: (userData: Partial<User>) => Promise<void>;
  resetPassword: (email: string) => Promise<{ success: boolean }>;
  updatePassword: (newPassword: string) => Promise<{ success: boolean }>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        console.log('Initializing auth...');
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Session error:', error);
          if (mounted) {
            setUser(null);
            setIsLoading(false);
          }
          return;
        }

        if (session?.user && mounted) {
          console.log('Found existing session, fetching user profile...');
          await fetchUserProfile(session.user);
        } else if (mounted) {
          console.log('No existing session found');
          setUser(null);
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
        if (mounted) {
          setUser(null);
          setIsLoading(false);
        }
      }
    };

    initializeAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event, session?.user?.email);
      
      if (!mounted) return;

      try {
        if (event === 'SIGNED_IN' && session?.user) {
          console.log('User signed in, fetching profile...');
          await fetchUserProfile(session.user);
        } else if (event === 'SIGNED_OUT' || !session?.user) {
          console.log('User signed out');
          setUser(null);
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Auth state change error:', error);
        setUser(null);
        setIsLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const fetchUserProfile = async (authUser: SupabaseUser) => {
    try {
      console.log('Fetching user profile for:', authUser.email);
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (data) {
        console.log('User profile found:', data.email);
        const userData = {
          id: data.id,
          firstName: data.first_name,
          lastName: data.last_name,
          email: data.email,
          phone: data.phone || undefined,
          dateOfBirth: data.date_of_birth || undefined,
        };
        setUser(userData);
        setIsLoading(false);
        return userData;
      } else if (error && error.code === 'PGRST116') {
        console.log('User profile not found, creating new profile...');
        // Create user profile if it doesn't exist
        const names = authUser.user_metadata?.full_name?.split(' ') || ['', ''];
        const firstName = names[0] || authUser.email?.split('@')[0] || 'User';
        const lastName = names.slice(1).join(' ') || '';

        const { data: newUser, error: insertError } = await supabase
          .from('users')
          .insert({
            id: authUser.id,
            first_name: firstName,
            last_name: lastName,
            email: authUser.email || '',
            phone: authUser.user_metadata?.phone || null,
          })
          .select()
          .single();

        if (insertError) {
          console.error('Error creating user profile:', insertError);
          throw insertError;
        }

        if (newUser) {
          console.log('New user profile created:', newUser.email);
          const userData = {
            id: newUser.id,
            firstName: newUser.first_name,
            lastName: newUser.last_name,
            email: newUser.email,
            phone: newUser.phone || undefined,
          };
          setUser(userData);
          setIsLoading(false);
          return userData;
        }
      } else if (error) {
        console.error('Error fetching user profile:', error);
        throw error;
      }
    } catch (error) {
      console.error('Error in fetchUserProfile:', error);
      setUser(null);
      setIsLoading(false);
      throw error;
    }
  };

  const login = async (email: string, password: string) => {
    try {
      console.log('Attempting login for:', email);
      setIsLoading(true);
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        console.error('Login error:', error);
        setIsLoading(false);
        throw new Error(error.message || 'Login failed');
      }

      if (!data.user) {
        console.error('No user data received');
        setIsLoading(false);
        throw new Error('Login failed - no user data received');
      }

      console.log('Login successful for:', email);
      // The auth state change listener will handle setting the user
      // Don't set loading to false here, let the auth state change handle it
      
    } catch (error: any) {
      console.error('Login error:', error);
      setIsLoading(false);
      throw error;
    }
  };

  const logout = async () => {
    try {
      console.log('Logging out...');
      setIsLoading(true);
      
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Logout error:', error);
        throw new Error(error.message || 'Logout failed');
      }
      
      console.log('Logout successful');
      setUser(null);
      setIsLoading(false);
    } catch (error: any) {
      console.error('Logout error:', error);
      setIsLoading(false);
      throw error;
    }
  };

  const register = async (
    firstName: string,
    lastName: string,
    email: string,
    phone: string,
    password: string
  ) => {
    try {
      console.log('Attempting registration for:', email);
      setIsLoading(true);

      // First check if user already exists
      const { data: existingUser } = await supabase
        .from('users')
        .select('email')
        .eq('email', email.trim())
        .single();

      if (existingUser) {
        setIsLoading(false);
        throw new Error('This email address is already registered. Please try logging in instead.');
      }

      // Sign up with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            phone: phone.trim()
          }
        }
      });

      if (authError) {
        console.error('Auth signup error:', authError);
        setIsLoading(false);
        if (authError.message.includes('already registered')) {
          throw new Error('This email address is already registered. Please try logging in instead.');
        }
        throw new Error(authError.message || 'Registration failed');
      }

      if (!authData.user) {
        setIsLoading(false);
        throw new Error('Registration failed - no user data received');
      }

      console.log('Auth registration successful, creating user profile...');

      // Create user profile in our users table
      const { error: profileError } = await supabase
        .from('users')
        .insert({
          id: authData.user.id,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
        });

      if (profileError) {
        console.error('Profile creation error:', profileError);
        // Don't throw error here, auth user was created successfully
      }

      console.log('Registration successful for:', email);
      setIsLoading(false);
      
      // Send welcome email (you can implement this later)
      console.log('Welcome email would be sent to:', email);
      
    } catch (error: any) {
      console.error('Registration error:', error);
      setIsLoading(false);
      throw error;
    }
  };

  const updateUser = async (userData: Partial<User>) => {
    if (!user) return;

    try {
      const updateData: any = {};
      if (userData.firstName) updateData.first_name = userData.firstName;
      if (userData.lastName) updateData.last_name = userData.lastName;
      if (userData.email) updateData.email = userData.email;
      if (userData.phone) updateData.phone = userData.phone;
      if (userData.dateOfBirth) updateData.date_of_birth = userData.dateOfBirth;

      const { error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', user.id);

      if (error) throw error;

      setUser({ ...user, ...userData });
    } catch (error: any) {
      console.error('Update user error:', error);
      throw new Error(error.message || 'Update failed');
    }
  };

  const resetPassword = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;
      return { success: true };
    } catch (error: any) {
      console.error('Password reset error:', error);
      throw new Error(error.message || 'Password reset failed');
    }
  };

  const updatePassword = async (newPassword: string) => {
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;
      return { success: true };
    } catch (error: any) {
      console.error('Password update error:', error);
      throw new Error(error.message || 'Password update failed');
    }
  };

  const contextValue = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
    register,
    updateUser,
    resetPassword,
    updatePassword
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};