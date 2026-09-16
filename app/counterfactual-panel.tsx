'use client';

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

type Props = {
  comparison: any;
  onApply: (alternative: any) => void;
  disabled?: boolean;
};

export default function CounterfactualPanel({comparison,onApply,disabled=false}: Props) {
  return <section className="counterfactual" aria-labelledby="counterfactual-title">
    <div className="sectiontitle">
      <div><span className="eyebrow">WHAT IF</span><h2 id="counterfactual-title">다른 조건이었다면?</h2></div>
      <span>예산만 바꿔 비교</span>
    </div>
    <p className="status">{comparison.message}</p>
    <div className="whatif-grid">
      {comparison.alternatives.map((a:any)=><article key={a.id} className="whatif-card">
        <div className="whatif-heading"><span className="whatif-badge">가상 비교 · 아직 미적용</span><h3>예산을 {won(a.delta)} 올리면</h3></div>
        <p className="whatif-budget">{won(a.amount-a.delta)} → <strong>{won(a.amount)}</strong> · 상품 하나 예산 · {a.shippingIncluded?'배송비 포함':'상품값 기준'}</p>
        <div className="versus">
          <div><span>현재 첫 번째 추천</span><strong>{a.current?.name.replace('가상 ','') || '조건에 맞는 상품 없음'}</strong>{a.current&&<p>{won(a.current.price_krw)}</p>}</div>
          <span className="versus-divider" aria-hidden="true">↔</span>
          <div><span>{a.effect==='eligible_only'?'새로 선택 가능한 후보':'가상 조건의 새 추천'}</span><strong>{a.target.name.replace('가상 ','')}</strong><p>{won(a.target.price_krw)}</p></div>
        </div>
        <p className="whatif-effect">{a.effectText}</p>
        <p className="whatif-rank">가상 조건에서 전체 후보 중 {a.targetRank}위</p>
        <div className="whatif-explanation"><h4>지금은 왜 이 상품이 아닌가요?</h4><p>{a.exclusionReason.replaceAll('세트당 예산','예산')}</p><p>{a.rankingReason}</p></div>
        {a.facts.length>0&&<ul className="whatif-facts">{a.facts.map((fact:string)=><li key={fact}>{fact}</li>)}</ul>}
        <button type="button" className="apply-budget" disabled={disabled} onClick={()=>onApply(a)} aria-label={`예산 ${won(a.amount)}으로 적용`}>이 예산으로 적용하기 ↗</button>
      </article>)}
    </div>
  </section>;
}
