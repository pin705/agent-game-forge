import { Routes, Route } from 'react-router-dom';
import { Dashboard } from '@/pages/Dashboard';
import { NewGame } from '@/pages/NewGame';
import { Build } from '@/pages/Build';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/new" element={<NewGame />} />
      <Route path="/build/:id" element={<Build />} />
    </Routes>
  );
}
