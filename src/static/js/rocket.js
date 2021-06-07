$(function () {
    init_lamden(main)
});







async function main() {
    const App = new RocketSwapController(Connector)
    // App.address --->
    await App.START()

}