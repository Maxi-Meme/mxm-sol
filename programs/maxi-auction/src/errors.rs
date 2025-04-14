use anchor_lang::*;

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------
#[error_code]
pub enum CustomError {
    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Calculation error")]
    CalculationError,

    #[msg("Token supply must be an integer with a specified decimal point.")]
    InvalidTokenSupplyAndDecimals,

    #[msg("Invalid Auction ID.")]
    InvalidAuctionId,

    #[msg("Reentrancy guard triggered.")]
    ReentrancyGuard,

    #[msg("Not enough tokens left.")]
    NotEnoughTokensLeft,

    #[msg("Max number of bids reached.")]
    MaxBidsReached,

    #[msg("Auction is still live.")]
    AuctionStillLive,

    #[msg("Auction is ended.")]
    AuctionEnded,

    #[msg("Auction is not finished.")]
    AuctionNotFinished,

    #[msg("No bid found for caller.")]
    NoBidFoundForCaller,

    #[msg("Invalid clearing price.")]
    InvalidClearingPrice,

    #[msg("Invalid length of remaining accounts.")]
    InvalidRemainingAccounts,

    #[msg("Invalid user account.")]
    InvalidUserAccount,

    #[msg("Invalid user's token account.")]
    InvalidUserTokenAccount,

    #[msg("Bid already claimed.")]
    BidAlreadyClaimed,
}
