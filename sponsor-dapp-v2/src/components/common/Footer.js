import React from 'react';
import { Link } from 'react-router-dom';

const Footer = props => {
    return (
        <div className="footer">
            <div className="shell">
                <div className="footer__inner">
                    <Link to="/Start" className="btn">
                        Get started
                    </Link>

                    <a href="test" className="link-default">
                        Need help ?
                    </a>
                </div>
            </div>
        </div>
    );
};

export default Footer;
