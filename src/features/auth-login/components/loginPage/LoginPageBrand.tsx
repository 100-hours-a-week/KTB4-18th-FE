export function LoginPageBrand() {
  return (
    <header className="login-brand">
      <span className="login-symbol-grid" aria-hidden="true">
        <span className="login-symbol-frame">
          <img className="login-symbol" src="/icons/auth/Logo.svg" alt="" />
        </span>
      </span>
      <div className="login-brand-copy">
        <h1 id="login-title" className="login-wordmark">
          머문음
        </h1>
        <p className="brand-tagline">머문 자리에, 음악이 남는다.</p>
      </div>
    </header>
  );
}
