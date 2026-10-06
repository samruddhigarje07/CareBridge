import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

class Boundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e) { console.error(e); }
  render() {
    return this.state.failed
      ? <div className="wrap"><div className="card center"><h2>Something went wrong</h2><p className="mut">Please reload the page.</p>
          <button className="btn pri" onClick={() => location.reload()}>Reload</button></div></div>
      : this.props.children;
  }
}
createRoot(document.getElementById("root")).render(<Boundary><App /></Boundary>);
