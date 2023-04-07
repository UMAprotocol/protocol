/// @title CTF Exchange
/// @notice Implements logic for trading CTF assets
contract CTFExchange {
    /// @notice Emitted when an order is filled
    event OrderFilled(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed taker,
        uint256 makerAssetId,
        uint256 takerAssetId,
        uint256 makerAmountFilled,
        uint256 takerAmountFilled,
        uint256 fee
    );

    function emitOrderFilled(
        bytes32 orderHash,
        address maker,
        address taker,
        uint256 makerAssetId,
        uint256 takerAssetId,
        uint256 makerAmountFilled,
        uint256 takerAmountFilled,
        uint256 fee
    ) public {
        emit OrderFilled(
            orderHash,
            maker,
            taker,
            makerAssetId,
            takerAssetId,
            makerAmountFilled,
            takerAmountFilled,
            fee
        );
    }
}
