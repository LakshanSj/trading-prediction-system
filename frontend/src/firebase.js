/**
 * firebase.js — Firebase Authentication and Firestore Log Database config.
 * Includes a fully functional Mock Mode fallback if Firebase environment variables are missing.
 */

import { initializeApp, getApps } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  updateProfile 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  writeBatch 
} from 'firebase/firestore';

// Retrieve environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Check if credentials are set (must have at least apiKey and projectId)
const isFirebaseConfigured = firebaseConfig.apiKey && firebaseConfig.projectId;

let app = null;
let auth = null;
let db = null;
let isMock = true;

if (isFirebaseConfigured) {
  try {
    if (getApps().length === 0) {
      app = initializeApp(firebaseConfig);
    } else {
      app = getApps()[0];
    }
    auth = getAuth(app);
    db = getFirestore(app);
    isMock = false;
    console.log("🔥 Connected to live Firebase Services successfully!");
  } catch (error) {
    console.error("⚠️ Failed to initialize Firebase SDK. Falling back to Mock Mode.", error);
    isMock = true;
  }
} else {
  console.log("ℹ️ No VITE_FIREBASE_API_KEY found in .env. Running in Mock Database & Auth Mode (persisted in LocalStorage).");
  isMock = true;
}

// ── Service interfaces ────────────────────────────────────────────────────────

export const authService = {
  // Login
  async login(emailOrUsername, password) {
    if (!isMock) {
      let email = emailOrUsername.trim();

      // If the identifier is a username (does not contain '@'), lookup the mapped email in Firestore
      if (!email.includes('@')) {
        try {
          const usersRef = collection(db, 'users');
          const q = query(usersRef, where('username_lowercase', '==', email.toLowerCase()));
          const querySnapshot = await getDocs(q);

          if (querySnapshot.empty) {
            throw new Error(`No account found with username "${emailOrUsername}".`);
          }

          let resolvedEmail = null;
          querySnapshot.forEach(doc => {
            resolvedEmail = doc.data().email;
          });

          if (resolvedEmail) {
            email = resolvedEmail;
          } else {
            throw new Error(`No email mapped to username "${emailOrUsername}".`);
          }
        } catch (err) {
          console.error("🔥 Firebase username lookup error:", err);
          throw new Error(err.message || "Failed to resolve username.");
        }
      }

      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      // Look up status in Firestore users collection
      let status = 'pending';
      try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('uid', '==', userCredential.user.uid));
        const querySnapshot = await getDocs(q);
        querySnapshot.forEach(doc => {
          status = doc.data().status || 'pending';
        });
        if (userCredential.user.email.toLowerCase() === 'admin@test.com' || userCredential.user.displayName === 'adminTrading') {
          status = 'approved';
        }
      } catch (err) {
        console.error("Failed to read user status from Firestore:", err);
      }

      return {
        uid: userCredential.user.uid,
        email: userCredential.user.email,
        username: userCredential.user.displayName || userCredential.user.email.split('@')[0],
        status: status
      };
    } else {
      // Mock Login
      const users = JSON.parse(localStorage.getItem('mock_users') || '[]');
      const user = users.find(u => 
        u.email.toLowerCase() === emailOrUsername.toLowerCase() ||
        u.username.toLowerCase() === emailOrUsername.toLowerCase()
      );
      if (!user) {
        throw new Error("No account found with this username or email. Please register.");
      }
      if (user.password !== password) {
        throw new Error("Invalid password. Please try again.");
      }
      const status = user.status || (user.username === 'adminTrading' ? 'approved' : 'pending');
      const sessionUser = { uid: `mock-${user.username}`, email: user.email, username: user.username, status: status };
      localStorage.setItem('mock_current_user', JSON.stringify(sessionUser));
      // Notify state listeners
      triggerMockAuthStateChange(sessionUser);
      return sessionUser;
    }
  },

  // Register
  async register(username, email, password) {
    if (!username || username.trim() === '') {
      throw new Error("Username is required.");
    }
    
    if (!isMock) {
      // Check username uniqueness via Firestore (if live)
      // Since firestore check is async, we query the user profiles collection
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('username_lowercase', '==', username.toLowerCase()));
      const snap = await getDocs(q);
      if (!snap.empty) {
        throw new Error(`Username "${username}" is already taken.`);
      }

      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      // Save display name in firebase auth
      await updateProfile(userCredential.user, { displayName: username });
      
      // Save profile metadata in Firestore users collection
      const userDocRef = collection(db, 'users');
      const initialStatus = (username === 'adminTrading') ? 'approved' : 'pending';
      await addDoc(userDocRef, {
        uid: userCredential.user.uid,
        username: username,
        username_lowercase: username.toLowerCase(),
        email: email,
        status: initialStatus,
        created_at: new Date().toISOString()
      });

      return {
        uid: userCredential.user.uid,
        email: userCredential.user.email,
        username: username,
        status: initialStatus
      };
    } else {
      // Mock Register
      const users = JSON.parse(localStorage.getItem('mock_users') || '[]');
      const usernameExists = users.some(u => u.username.toLowerCase() === username.toLowerCase());
      if (usernameExists) {
        throw new Error(`Username "${username}" is already taken.`);
      }
      const emailExists = users.some(u => u.email.toLowerCase() === email.toLowerCase());
      if (emailExists) {
        throw new Error(`An account with email "${email}" already exists.`);
      }

      const initialStatus = (username === 'adminTrading') ? 'approved' : 'pending';
      const newUser = { username, email, password, status: initialStatus, created_at: new Date().toISOString() };
      users.push(newUser);
      localStorage.setItem('mock_users', JSON.stringify(users));

      const sessionUser = { uid: `mock-${username}`, email: email, username: username, status: initialStatus };
      localStorage.setItem('mock_current_user', JSON.stringify(sessionUser));
      triggerMockAuthStateChange(sessionUser);
      return sessionUser;
    }
  },

  // Logout
  async logout() {
    if (!isMock) {
      await signOut(auth);
    } else {
      localStorage.removeItem('mock_current_user');
      triggerMockAuthStateChange(null);
    }
  },

  // State Listener
  onAuthStateChanged(callback) {
    if (!isMock) {
      return onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          // Look up user status in Firestore
          let status = 'pending';
          try {
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('uid', '==', firebaseUser.uid));
            const querySnapshot = await getDocs(q);
            querySnapshot.forEach(doc => {
              status = doc.data().status || 'pending';
            });
            if (firebaseUser.email.toLowerCase() === 'admin@test.com' || firebaseUser.displayName === 'adminTrading') {
              status = 'approved';
            }
          } catch (err) {
            console.error("Firestore user status fetch error:", err);
          }
          callback({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            username: firebaseUser.displayName || firebaseUser.email.split('@')[0],
            status: status
          });
        } else {
          callback(null);
        }
      });
    } else {
      // Add callback to mock listeners list
      mockListeners.push(callback);
      // Immediately call with initial session if exists
      const savedUser = localStorage.getItem('mock_current_user');
      callback(savedUser ? JSON.parse(savedUser) : null);
      // Return unsubscribe function
      return () => {
        const index = mockListeners.indexOf(callback);
        if (index > -1) mockListeners.splice(index, 1);
      };
    }
  }
};

export const dbService = {
  // Log Activity
  async logActivity(username, email, eventType, details = {}) {
    const timestamp = new Date().toISOString();
    const timestampLocal = new Date().toLocaleString();
    
    const logEntry = {
      username,
      email,
      event_type: eventType,
      timestamp,
      timestamp_local: timestampLocal,
      details
    };

    if (!isMock) {
      try {
        const logsRef = collection(db, 'user_logs');
        await addDoc(logsRef, logEntry);
      } catch (e) {
        console.error("Firestore logging error:", e);
      }
    } else {
      // Mock Logs
      const logs = JSON.parse(localStorage.getItem('mock_logs') || '[]');
      // Auto-increment ID
      const newLog = { id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, ...logEntry };
      logs.push(newLog);
      // Cap at 1000 logs for local storage optimization
      if (logs.length > 1000) {
        logs.shift();
      }
      localStorage.setItem('mock_logs', JSON.stringify(logs));
    }
    return logEntry;
  },

  // Fetch user logs
  async fetchUserLogs(username) {
    if (!isMock) {
      try {
        const logsRef = collection(db, 'user_logs');
        // Retrieve newest logs first.
        const q = query(
          logsRef,
          where('username', '==', username)
        );
        const querySnapshot = await getDocs(q);
        const logs = [];
        querySnapshot.forEach((doc) => {
          logs.push({ id: doc.id, ...doc.data() });
        });
        // Sort descending by timestamp
        logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        return logs;
      } catch (error) {
        console.error("Error fetching logs from Firestore:", error);
        return [];
      }
    } else {
      // Mock fetch
      const logs = JSON.parse(localStorage.getItem('mock_logs') || '[]');
      const filtered = logs.filter(log => log.username.toLowerCase() === username.toLowerCase());
      filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      return filtered;
    }
  },

  // Clear logs for a specific user
  async clearUserLogs(username) {
    if (!isMock) {
      try {
        const logsRef = collection(db, 'user_logs');
        const q = query(logsRef, where('username', '==', username));
        const querySnapshot = await getDocs(q);
        
        // Use batch delete
        const batch = writeBatch(db);
        querySnapshot.forEach((doc) => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        return querySnapshot.size;
      } catch (error) {
        console.error("Error clearing logs in Firestore:", error);
        return 0;
      }
    } else {
      // Mock clear
      const logs = JSON.parse(localStorage.getItem('mock_logs') || '[]');
      const remainingLogs = logs.filter(log => log.username.toLowerCase() !== username.toLowerCase());
      const clearedCount = logs.length - remainingLogs.length;
      localStorage.setItem('mock_logs', JSON.stringify(remainingLogs));
      return clearedCount;
    }
  },

  // Fetch users by approval status
  async fetchUsers(status) {
    if (!isMock) {
      try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('status', '==', status));
        const querySnapshot = await getDocs(q);
        const users = [];
        querySnapshot.forEach((doc) => {
          users.push({ id: doc.id, ...doc.data() });
        });
        return users;
      } catch (error) {
        console.error("Error fetching users from Firestore:", error);
        return [];
      }
    } else {
      // Mock fetch
      const mockUsers = JSON.parse(localStorage.getItem('mock_users') || '[]');
      const filtered = mockUsers.map(u => ({
        uid: `mock-${u.username}`,
        username: u.username,
        email: u.email,
        status: u.status || (u.username === 'adminTrading' ? 'approved' : 'pending'),
        created_at: u.created_at || new Date().toISOString()
      })).filter(u => u.status === status);
      return filtered;
    }
  },

  // Update user approval status
  async updateUserStatus(username, newStatus) {
    if (!isMock) {
      try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('username_lowercase', '==', username.toLowerCase()));
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
          throw new Error(`User "${username}" not found.`);
        }
        
        const batch = writeBatch(db);
        querySnapshot.forEach((doc) => {
          batch.update(doc.ref, { status: newStatus });
        });
        await batch.commit();
        return true;
      } catch (error) {
        console.error("Error updating user status in Firestore:", error);
        return false;
      }
    } else {
      // Mock update
      const mockUsers = JSON.parse(localStorage.getItem('mock_users') || '[]');
      const userIndex = mockUsers.findIndex(u => u.username.toLowerCase() === username.toLowerCase());
      if (userIndex > -1) {
        mockUsers[userIndex].status = newStatus;
        localStorage.setItem('mock_users', JSON.stringify(mockUsers));
        
        // Synchronize mock active session if necessary
        const currentSaved = localStorage.getItem('mock_current_user');
        if (currentSaved) {
          const userObj = JSON.parse(currentSaved);
          if (userObj.username.toLowerCase() === username.toLowerCase()) {
            userObj.status = newStatus;
            localStorage.setItem('mock_current_user', JSON.stringify(userObj));
            triggerMockAuthStateChange(userObj);
          }
        }
        return true;
      }
      return false;
    }
  },

  // Reset all registered users to pending (except adminTrading)
  async resetAllUsersToPending() {
    if (!isMock) {
      try {
        const usersRef = collection(db, 'users');
        const querySnapshot = await getDocs(usersRef);
        const batch = writeBatch(db);
        let count = 0;
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          if (data.username !== 'adminTrading') {
            batch.update(doc.ref, { status: 'pending' });
            count++;
          }
        });
        if (count > 0) {
          await batch.commit();
        }
        return count;
      } catch (error) {
        console.error("Error resetting users in Firestore:", error);
        throw error;
      }
    } else {
      // Mock reset
      const mockUsers = JSON.parse(localStorage.getItem('mock_users') || '[]');
      const updated = mockUsers.map(u => {
        if (u.username !== 'adminTrading') {
          return { ...u, status: 'pending' };
        }
        return u;
      });
      localStorage.setItem('mock_users', JSON.stringify(updated));
      
      // Also synchronize mock active session if guest is logged in
      const currentSaved = localStorage.getItem('mock_current_user');
      if (currentSaved) {
        const userObj = JSON.parse(currentSaved);
        if (userObj.username !== 'adminTrading') {
          userObj.status = 'pending';
          localStorage.setItem('mock_current_user', JSON.stringify(userObj));
          triggerMockAuthStateChange(userObj);
        }
      }
    }
  },

  // Save prediction records
  async savePredictionRecord(record) {
    const accuracyVal = record.accuracy;
    const resultStatus = accuracyVal >= 0.85 ? "Success" : "Failed";
    
    // Extract month (YYYY-MM) from trained_at timestamp (e.g. "2026-07-09T17:44:08" -> "2026-07")
    let recordMonth = "2026-07";
    if (record.trained_at) {
      try {
        recordMonth = record.trained_at.substring(0, 7);
      } catch {
        recordMonth = new Date().toISOString().substring(0, 7);
      }
    } else {
      recordMonth = new Date().toISOString().substring(0, 7);
    }
    
    const recordEntry = {
      trained_at: record.trained_at || new Date().toISOString(),
      ticker: record.ticker,
      predict: record.predict,
      accuracy: accuracyVal,
      result: resultStatus,
      month: recordMonth,
      created_at: new Date().toISOString()
    };

    if (!isMock) {
      try {
        const recordsRef = collection(db, 'prediction_records');
        const q = query(recordsRef, where('trained_at', '==', recordEntry.trained_at));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          return false; // Already recorded
        }
        await addDoc(recordsRef, recordEntry);
        return true;
      } catch (e) {
        console.error("Firestore save prediction record error:", e);
        return false;
      }
    } else {
      const records = JSON.parse(localStorage.getItem('mock_prediction_records') || '[]');
      const exists = records.some(r => r.trained_at === recordEntry.trained_at && r.ticker === recordEntry.ticker);
      if (exists) {
        return false;
      }
      records.push(recordEntry);
      localStorage.setItem('mock_prediction_records', JSON.stringify(records));
      return true;
    }
  },

  // Fetch prediction records
  async fetchPredictionRecords() {
    if (!isMock) {
      try {
        const recordsRef = collection(db, 'prediction_records');
        const querySnapshot = await getDocs(recordsRef);
        const list = [];
        querySnapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() });
        });
        return list;
      } catch (error) {
        console.error("Error fetching prediction records from Firestore:", error);
        return [];
      }
    } else {
      return JSON.parse(localStorage.getItem('mock_prediction_records') || '[]');
    }
  }
};

// State flag helper
export const isMockFirebase = () => isMock;

// ── Mock Event Listener Bus ─────────────────────────────────────────────────
const mockListeners = [];
function triggerMockAuthStateChange(user) {
  mockListeners.forEach(callback => {
    try {
      callback(user);
    } catch (e) {
      console.error("Error in mock auth state listener:", e);
    }
  });
}

// ── One-time automatic mock database status migration ────────────────────────
// Guarded by a version key so this only executes ONCE per browser, not on every page load.
const MOCK_MIGRATION_VERSION = 'v2';
if (localStorage.getItem('mock_db_version') !== MOCK_MIGRATION_VERSION) {
  try {
    const mockUsers = JSON.parse(localStorage.getItem('mock_users') || '[]');
    let migrated = false;
    const updated = mockUsers.map(u => {
      const correctStatus = (u.username === 'adminTrading') ? 'approved' : 'pending';
      if (!u.status || (u.username !== 'adminTrading' && u.status !== 'pending')) {
        migrated = true;
        return { ...u, status: correctStatus };
      }
      return u;
    });
    if (migrated) {
      localStorage.setItem('mock_users', JSON.stringify(updated));
      console.log('⚡ Auto-migrated existing mock users to pending status (except adminTrading).');
    }
    localStorage.setItem('mock_db_version', MOCK_MIGRATION_VERSION);
  } catch (e) {
    console.error('Mock migration error:', e);
  }
}

// ── One-time mock prediction history self-seeding ───────────────────────────
try {
  const existingRecords = localStorage.getItem('mock_prediction_records');
  if (!existingRecords) {
    const seedRecords = [
      // May 2026
      { trained_at: "2026-05-05T08:00:00", ticker: "BTC-USD", predict: "Up", accuracy: 0.885, result: "Success", month: "2026-05", created_at: "2026-05-05T08:00:00" },
      { trained_at: "2026-05-06T08:00:00", ticker: "ETH-USD", predict: "Down", accuracy: 0.820, result: "Failed", month: "2026-05", created_at: "2026-05-06T08:00:00" },
      { trained_at: "2026-05-07T08:00:00", ticker: "SOL-USD", predict: "Up", accuracy: 0.890, result: "Success", month: "2026-05", created_at: "2026-05-07T08:00:00" },
      { trained_at: "2026-05-08T08:00:00", ticker: "XRP-USD", predict: "Up", accuracy: 0.765, result: "Failed", month: "2026-05", created_at: "2026-05-08T08:00:00" },
      { trained_at: "2026-05-09T08:00:00", ticker: "DOGE-USD", predict: "Down", accuracy: 0.910, result: "Success", month: "2026-05", created_at: "2026-05-09T08:00:00" },
      // June 2026
      { trained_at: "2026-06-10T08:00:00", ticker: "BTC-USD", predict: "Down", accuracy: 0.860, result: "Success", month: "2026-06", created_at: "2026-06-10T08:00:00" },
      { trained_at: "2026-06-11T08:00:00", ticker: "ETH-USD", predict: "Up", accuracy: 0.925, result: "Success", month: "2026-06", created_at: "2026-06-11T08:00:00" },
      { trained_at: "2026-06-12T08:00:00", ticker: "SOL-USD", predict: "Down", accuracy: 0.845, result: "Failed", month: "2026-06", created_at: "2026-06-12T08:00:00" },
      { trained_at: "2026-06-13T08:00:00", ticker: "XRP-USD", predict: "Up", accuracy: 0.870, result: "Success", month: "2026-06", created_at: "2026-06-13T08:00:00" },
      { trained_at: "2026-06-14T08:00:00", ticker: "DOGE-USD", predict: "Up", accuracy: 0.880, result: "Success", month: "2026-06", created_at: "2026-06-14T08:00:00" }
    ];
    localStorage.setItem('mock_prediction_records', JSON.stringify(seedRecords));
    console.log("⚡ Auto-seeded mock prediction history for training growth demo.");
  }
} catch (e) {
  console.error("Mock prediction seed error:", e);
}

