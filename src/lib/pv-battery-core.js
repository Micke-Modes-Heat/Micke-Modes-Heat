// @ts-check

/**
 * Ein kanonischer Stunden-Schritt für PV/BHKW, Batterie und Netz.
 * @param {{demand:number,pvGen:number,bhkwGen:number,socKwh:number,capacityKwh:number,powerKw:number,etaCharge?:number,etaDischarge?:number}} input
 */
export function pvBatteryStep(input) {
  const demand = Math.max(0, Number(input.demand) || 0);
  const pvGen = Math.max(0, Number(input.pvGen) || 0);
  const bhkwGen = Math.max(0, Number(input.bhkwGen) || 0);
  const capacity = Math.max(0, Number(input.capacityKwh) || 0);
  const power = Math.max(0, Number(input.powerKw) || 0);
  const etaCharge = Math.max(0.0001, Math.min(1, Number(input.etaCharge) || 1));
  const etaDischarge = Math.max(0.0001, Math.min(1, Number(input.etaDischarge) || 0.9));
  let soc = Math.max(0, Math.min(capacity, Number(input.socKwh) || 0));
  const gen = pvGen + bhkwGen;
  const direct = Math.min(gen, demand);
  const pvFraction = gen > 0 ? pvGen / gen : 0;
  let residualDemand = demand - direct;
  let residualGeneration = gen - direct;
  let losses = 0;
  let chargedKwh = 0, dischargedKwh = 0;
  if (capacity > 0 && power > 0 && residualGeneration > 0) {
    const chargeInput = Math.min(residualGeneration, power, (capacity - soc) / etaCharge);
    soc += chargeInput * etaCharge;
    chargedKwh = chargeInput;
    residualGeneration -= chargeInput;
    losses += chargeInput * (1 - etaCharge);
  }
  if (capacity > 0 && power > 0 && residualDemand > 0) {
    const delivered = Math.min(residualDemand, power, soc * etaDischarge);
    soc -= delivered / etaDischarge;
    dischargedKwh = delivered;
    residualDemand -= delivered;
    losses += delivered / etaDischarge - delivered;
  }
  return {demand, pvGen, bhkwGen, gen, direct, pvFraction, residualDemand, residualGeneration, socKwh:soc, lossesKwh:losses, chargedKwh, dischargedKwh};
}
