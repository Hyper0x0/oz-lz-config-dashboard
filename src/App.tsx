import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { OFTWiring } from '@/pages/OFTWiring';
import { Timelock } from '@/pages/Timelock';

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <nav className="nav">
        <span className="nav-brand">OFT Config Dashboard</span>
        <div className="nav-links">
          <NavLink to="/" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Timelock
          </NavLink>
          <NavLink to="/wiring" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            OFT Wiring
          </NavLink>
        </div>
      </nav>

      <main className="main">
        <Routes>
          <Route path="/" element={<Timelock />} />
          <Route path="/wiring" element={<OFTWiring />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
