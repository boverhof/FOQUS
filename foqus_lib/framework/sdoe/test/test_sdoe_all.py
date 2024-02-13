#################################################################################
# FOQUS Copyright (c) 2012 - 2023, by the software owners: Oak Ridge Institute
# for Science and Education (ORISE), TRIAD National Security, LLC., Lawrence
# Livermore National Security, LLC., The Regents of the University of
# California, through Lawrence Berkeley National Laboratory, Battelle Memorial
# Institute, Pacific Northwest Division through Pacific Northwest National
# Laboratory, Carnegie Mellon University, West Virginia University, Boston
# University, the Trustees of Princeton University, The University of Texas at
# Austin, URS Energy & Construction, Inc., et al.  All rights reserved.
#
# Please see the file LICENSE.md for full copyright and license information,
# respectively. This file is also available online at the URL
# "https://github.com/CCSI-Toolset/FOQUS".
#################################################################################
from importlib import resources
from pathlib import Path
import os, time
from foqus_lib.framework.sdoe import sdoe,usf
import numpy as np
import pandas as pd
import configparser

def load(fname, index=None):
    # load file as data frame
    df = pd.read_csv(fname)
    df.rename(columns=lambda x: x.strip(), inplace=True)
    if index:
        df.set_index(index, inplace=True)
    return df

def test_run_usf():

    config_file = "config_usf.ini"
    nd = 2
    #copy_from_package("candidates_usf.csv")
    #copy_from_package(config_file)

    result = run(config_file=config_file, nd=nd, test=False)


def run(config_file, nd, test=False):

    # parse config file
    config = configparser.ConfigParser(allow_no_value=True)
    config.read(config_file)

    mode = config["METHOD"]["mode"]
    nr = int(config["METHOD"]["number_random_starts"])

    hfile = config["INPUT"]["history_file"]
    cfile = config["INPUT"]["candidate_file"]
    include = [s.strip() for s in config["INPUT"]["include"].split(",")]

    max_vals = [float(s) for s in config["INPUT"]["max_vals"].split(",")]
    min_vals = [float(s) for s in config["INPUT"]["min_vals"].split(",")]

    types = [s.strip() for s in config["INPUT"]["types"].split(",")]
    # 'Input' columns
    idx = [x for x, t in zip(include, types) if t == "Input"]
    # 'Index' column (should only be one)
    id_ = [x for x, t in zip(include, types) if t == "Index"]
    if id_:
        assert (
            len(id_) == 1
        ), "Multiple INDEX columns detected. There should only be one INDEX column."
        id_ = id_[0]
    else:
        id_ = None

    outdir = config["OUTPUT"]["results_dir"]

    sf_method = config["SF"]["sf_method"]

    assert sf_method == "usf"
    scl = np.array([ub - lb for ub, lb in zip(max_vals, min_vals)])
    args = {
        "icol": id_,
        "xcols": idx,
        "scale_factors": pd.Series(scl, index=include),
    }

    # create outdir as needed
    if not os.path.exists(outdir):
        os.makedirs(outdir)

    # load candidates
    if cfile:
        cand = load(cfile, index=id_)
        if len(include) == 1 and include[0] == "all":
            include = list(cand)

    # load history
    if hfile != "":
        hist = load(hfile, index=id_)
    else:
        hist = None


    # otherwise, run sdoe for real
    t0 = time.time()
    #results = usf.criterion(cand, args, nr, nd, mode=mode, hist=hist)
    usf.criterion_all(cand, args, nd, mode=mode, hist=hist)
    elapsed_time = time.time() - t0

    # # save the output
    # if sf_method == "usf":
    #     suffix = "d{}_n{}_{}".format(nd, nr, "+".join(include))
    #     fnames = {
    #         "cand": os.path.join(outdir, "usf_{}.csv".format(suffix)),
    #         "dmat": os.path.join(outdir, "usf_dmat_{}.npy".format(suffix)),
    #     }
    #     save(fnames, results, elapsed_time)
    #return fnames, results, elapsed_time
