'use client';

import { alternarPermissao, modulosDaEmpresa, type Permissao } from '@plataforma/contratos';

// As permissões de uma empresa como caixas de seleção: cada módulo e, recuadas, as subpermissões dele, que só
// podem ser marcadas com o módulo marcado. Os módulos vêm do catálogo: módulo novo aparece aqui sozinho.
export function CamposPermissoes({
  empresa,
  nomeEmpresa,
  valor,
  aoMudar,
  desabilitado = false,
}: {
  empresa: string;
  nomeEmpresa: string;
  valor: readonly string[];
  aoMudar: (permissoes: Permissao[]) => void;
  desabilitado?: boolean;
}) {
  const caixa = (chave: Permissao, rotulo: string, travada: boolean) => (
    <label key={chave} className="opcao">
      <input
        type="checkbox"
        checked={valor.includes(chave)}
        disabled={desabilitado || travada}
        onChange={(evento) => aoMudar(alternarPermissao(valor, chave, evento.target.checked))}
      />
      {rotulo}
    </label>
  );

  return (
    <fieldset className="campo permissoes">
      <legend>Permissões em {nomeEmpresa}</legend>
      {modulosDaEmpresa(empresa).map((modulo) => (
        <div key={modulo.chave} className="permissoes-modulo">
          {caixa(modulo.chave, modulo.rotulo, false)}
          {modulo.subpermissoes.length > 0 && (
            <div className="permissoes-sub">
              {modulo.subpermissoes.map((sub) =>
                caixa(sub.chave, sub.rotulo, !valor.includes(modulo.chave)),
              )}
            </div>
          )}
        </div>
      ))}
    </fieldset>
  );
}
