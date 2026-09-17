const skipTo = (seconds) => ({
    clickTrackingParams: null,
    showEngagementPanelEndpoint: {
        customAction: { action: 'SKIP', parameters: { time: seconds } }
    }
});

export { skipTo };
