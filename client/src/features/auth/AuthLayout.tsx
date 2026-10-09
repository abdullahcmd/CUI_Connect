import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import logo from '../../assets/img/cui-logo.png'
import './auth.css'

export function AuthLayout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="auth">
      <header className="auth__top">
        <Link to="/login" className="auth__logo"><img src={logo} alt="" /> CUI Connect</Link>
      </header>
      <main className="auth__main"><div className={`auth__card ${wide ? 'auth__card--wide' : ''}`}>{children}</div></main>
      <footer className="auth__bottom">
        <span>COMSATS University Islamabad · Fall 2026</span>
        <a href="mailto:it-support@comsats.edu.pk">Need help?</a>
      </footer>
    </div>
  )
}
