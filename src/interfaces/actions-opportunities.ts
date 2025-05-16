export default interface ActionsOpportunities {
  isCanFold: boolean,
  isCanCall: boolean,
  // callAmount: number,
  isCanCheck: boolean,
  isCanBet: boolean,
  betMinAmount: number,
  isCanRaise: boolean,
  isCanReRaise: boolean,
  raiseMinAmount: number,
  isCanAllIn: boolean,
  allInAmount: number, 
}
