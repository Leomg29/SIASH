# SIASH Cloud v0.13.3 — Correção de integridade das referências

## Causa raiz corrigida
A v0.13.2 passou a eliminar referências bibliograficamente duplicadas. Entretanto, uma validação posterior ainda exigia que toda URL retornada pela IA aparecesse literalmente no Word final. Quando uma fonte nova era semanticamente equivalente a uma referência institucional já existente, a deduplicação funcionava corretamente, mas a URL era removida e a validação antiga interpretava isso como falha de integridade.

## Correção
- A validação final agora verifica **representação bibliográfica semântica**, não presença literal de cada URL.
- Se uma obra já está presente na bibliografia institucional, ela é considerada coberta e não é duplicada.
- Volumes distintos continuam tratados como obras distintas.
- Referências realmente não representadas continuam bloqueando a proposta.
- Rótulos internos de confiança continuam fora do Word institucional.
- Referências continuam obrigatoriamente dentro da seção bibliográfica e antes de Assinatura/Carimbo.
- Aprovação e publicação continuam exclusivamente humanas.
- Nenhuma regra de negócio, permissão, histórico, documento vigente ou fluxo já validado foi removido.

## Refinamento de interface
Os identificadores visuais de versão foram sincronizados para v0.13.3, eliminando a divergência entre a versão implantada e a versão exibida no login/barra lateral.
