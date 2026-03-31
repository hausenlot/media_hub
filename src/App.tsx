import { useState } from 'react';
import { DubbingPage } from './components/DubbingPage';
import './App.css';

type AppTab = 'tts' | 'stt' | 'dub';

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('dub');

  return (
    <div className="app-root">
      {/* Non-intrusive floating navigation */}
      <nav className="main-nav">
        <button 
          className={`nav-item ${activeTab === 'dub' ? 'active' : ''}`}
          onClick={() => setActiveTab('dub')}
          data-tooltip="Dub Video"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7"></polygon>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
          </svg>
        </button>
        <button 
          className={`nav-item ${activeTab === 'tts' ? 'active' : ''}`}
          onClick={() => setActiveTab('tts')}
          data-tooltip="Text to Speech"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
        </button>
        <button 
          className={`nav-item ${activeTab === 'stt' ? 'active' : ''}`}
          onClick={() => setActiveTab('stt')}
          data-tooltip="Speech to Text"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
        </button>
      </nav>

      {/* Main Content Area */}
      <main className="main-content">
        {activeTab === 'dub' && <DubbingPage />}
        {activeTab === 'tts' && (
          <div className="placeholder-page">
            <h2>Text to Speech</h2>
            <p>Module integration coming soon...</p>
          </div>
        )}
        {activeTab === 'stt' && (
          <div className="placeholder-page">
            <h2>Speech to Text</h2>
            <p>Module integration coming soon...</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
