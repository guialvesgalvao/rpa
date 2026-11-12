'use client';

import { useState, type InputHTMLAttributes } from 'react';

// Campo de senha com o botão "olhinho", que mostra ou oculta o que foi digitado. As demais props vão para o input.
export function CampoSenha(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visivel, setVisivel] = useState(false);
  const rotulo = visivel ? 'Ocultar senha' : 'Mostrar senha';
  return (
    <div className="campo-senha">
      <input {...props} type={visivel ? 'text' : 'password'} />
      <button
        type="button"
        className="olho-senha"
        aria-label={rotulo}
        aria-pressed={visivel}
        aria-controls={props.id}
        title={rotulo}
        disabled={props.disabled}
        onClick={() => setVisivel((atual) => !atual)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
          {visivel && (
            <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          )}
        </svg>
      </button>
    </div>
  );
}
