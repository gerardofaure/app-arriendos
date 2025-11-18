import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, key: props.resetKey || "0" };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey) {
      // reset
      this.setState({ hasError: false, key: this.props.resetKey || "0" });
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="error-fallback">
          <div className="error-title">SE PRODUJO UN ERROR AL RENDERIZAR</div>
          <button className="btn" onClick={() => this.setState({ hasError: false })}>REINTENTAR</button>
        </div>
      );
    }
    return this.props.children;
  }
}
