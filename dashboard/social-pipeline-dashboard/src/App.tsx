import { Routes, Route } from 'react-router-dom';
import Sidebar from '@/components/Sidebar';
import Overview from '@/pages/Overview';
import Runs from '@/pages/Runs';
import RunDetail from '@/pages/RunDetail';
import Approvals from '@/pages/Approvals';
import Campaigns from '@/pages/Campaigns';
import MediaStudio from '@/pages/MediaStudio';
import Research from '@/pages/Research';
import Schedule from '@/pages/Schedule';
import Inbox from '@/pages/Inbox';
import Analytics from '@/pages/Analytics';
import Settings from '@/pages/Settings';

export default function App() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 ml-60">
        <div className="p-8">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/runs" element={<Runs />} />
            <Route path="/runs/:id" element={<RunDetail />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/research" element={<Research />} />
            <Route path="/media-studio" element={<MediaStudio />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
