export function configure(app, config: any) {
    app.get('/', (req, res) => {
        res.render('../overview/index.html', {});
    });

    app.get('/for-listeners', (req, res) => {
        res.render('../overview/index.html', {});
    });

    app.get('/how-it-works', (req, res) => {
        res.render('../overview/index.html', {});
    });

    app.get('/for-musicians', (req, res) => {
        res.render('../overview/index.html', {});
    });

    app.get('/currency', (req, res) => {
        res.render('../overview/index.html', {});
    });

    app.get('/faq', (req, res) => {
        res.render('../overview/index.html', {});
    });

    app.get('/bounty', (req, res) => {
        res.render('../overview/index.html', {});
    });
}