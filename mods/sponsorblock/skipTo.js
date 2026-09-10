// The command that moves the player to a time. Both the manual-skip cards and the highlight
// button send it, and it is the one shape they share.

const skipTo = (seconds) => ({
    clickTrackingParams: null,
    showEngagementPanelEndpoint: {
        customAction: { action: 'SKIP', parameters: { time: seconds } }
    }
});

export { skipTo };
