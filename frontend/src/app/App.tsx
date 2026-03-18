import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useParams, useNavigate, useLocation } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { ChatArea } from '@/features/chat';
import { useDiscussionStore } from '@/features/discussions';
import { useDocumentStore } from '@/features/documents';
import { useAuthStore, AuthModal } from '@/features/auth';
import { SharedChatPage } from './SharedChatPage';
import './App.css';

function ChatPage() {
  const { discussionId } = useParams<{ discussionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { setActiveDiscussionId, discussions } = useDiscussionStore();
  const initialMessage = location.state?.initialMessage;

  // URL is the single source of truth - sync URL param to store
  useEffect(() => {
    if (discussionId) {
      // Check if discussion exists before setting
      const exists = discussions.length === 0 || discussions.some((d) => d.id === discussionId);
      if (exists) {
        setActiveDiscussionId(discussionId);
      } else {
        // Invalid discussion ID - redirect to base chat
        navigate('/chat', { replace: true });
      }
    } else {
      // No discussion ID in URL - clear active discussion
      setActiveDiscussionId(null);
    }
  }, [discussionId, discussions, setActiveDiscussionId, navigate]);

  return <ChatArea initialMessage={initialMessage} />;
}

function AppLayout() {
  const { fetchDocuments } = useDocumentStore();
  const { user } = useAuthStore();

  useEffect(() => {
    if (user) fetchDocuments();
  }, [fetchDocuments, user]);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:discussionId" element={<ChatPage />} />
        </Routes>
      </main>
    </div>
  );
}

/**
 * Wrapper for /share/:discussionId that enforces authentication.
 * Invariant: if the user is not logged in, we redirect to /chat with a ?next=
 * param so AuthModal can send them back after sign-in. The AuthModal is
 * rendered at the App level so it will appear over this page.
 */
function SharedChatRoute() {
  const { user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      // Preserve the intended share URL so we can redirect back post-login
      navigate(`/chat?next=${encodeURIComponent(location.pathname)}`, { replace: true });
    }
  }, [user, location.pathname, navigate]);

  if (!user) return null;
  return <SharedChatPage />;
}

function App() {
  const { user, isInitializing, initialize } = useAuthStore();
  const [isProcessingAuth, setIsProcessingAuth] = useState(false);

  useEffect(() => {
    // Check if URL contains auth tokens (email confirmation flow)
    const urlHasAuthTokens = window.location.hash.includes('access_token') ||
                            window.location.hash.includes('refresh_token');

    if (urlHasAuthTokens) {
      setIsProcessingAuth(true);
    }

    initialize();
  }, [initialize]);

  // Clear auth processing state and URL hash once user is authenticated
  useEffect(() => {
    if (user && isProcessingAuth) {
      setIsProcessingAuth(false);
      // Clean up URL hash after successful authentication
      if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  }, [user, isProcessingAuth]);

  // After login, redirect to ?next= share URL if present
  useEffect(() => {
    if (user) {
      const params = new URLSearchParams(window.location.search);
      const next = params.get('next');
      if (next && next.startsWith('/share/')) {
        window.history.replaceState(null, '', next);
        window.location.reload();
      }
    }
  }, [user]);

  // Show loading while initializing OR processing auth tokens
  if (isInitializing || isProcessingAuth) {
    return (
      <div className="auth-loading">
        <div className="spinner" />
        {isProcessingAuth && (
          <p style={{ marginTop: '16px', color: 'var(--gray-600)' }}>
            Confirming your email...
          </p>
        )}
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Share route: full-width, no sidebar, auth-gated */}
        <Route path="/share/:discussionId" element={<SharedChatRoute />} />
        {/* Main app layout: sidebar + chat */}
        <Route path="/*" element={<AppLayout />} />
      </Routes>
      <AuthModal isOpen={!user} />
    </BrowserRouter>
  );
}

export default App;
