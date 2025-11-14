// src/components/ErrorBoundary.jsx
import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props){
    super(props);
    this.state = { hasError:false, error:null };
  }
  static getDerivedStateFromError(error){
    return { hasError:true, error };
  }
  componentDidCatch(error, info){
    console.error("ErrorBoundary atrapó:", error, info);
  }
  componentDidUpdate(prevProps){
    // si cambia la key externa, reseteo automáticamente el estado de error
    if (this.props.resetKey !== prevProps.resetKey && this.state.hasError){
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({ hasError:false, error:null });
    }
  }
  render(){
    if(this.state.hasError){
      return (
        <div style={{maxWidth:820, margin:"60px auto", padding:16, border:"1px solid #e5e7eb", borderRadius:12, background:"#fff"}}>
          <h2 style={{marginTop:0}}>Se produjo un error al renderizar.</h2>
          <pre style={{whiteSpace:"pre-wrap"}}>{String(this.state.error?.message || this.state.error)}</pre>
          <button
            onClick={()=>this.setState({hasError:false, error:null})}
            style={{marginTop:12, padding:"8px 12px", borderRadius:10, border:"1px solid #e5e7eb", fontWeight:700, cursor:"pointer"}}
          >
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
